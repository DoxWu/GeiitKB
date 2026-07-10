"""
熔断器模块

作用：
    基于 Redis 的熔断器实现，保护系统在依赖服务（LLM、Embedding、外部 API 等）
    持续故障时快速失败，避免资源耗尽和级联故障。

    三种状态：
    1. CLOSED（关闭/正常）：放行请求，统计失败次数
    2. OPEN（打开/熔断）：快速失败，直接拒绝请求，等待恢复时间后自动半开
    3. HALF_OPEN（半开/探测）：放行一次探测请求，成功则恢复 CLOSED，失败则重新 OPEN

实现方式：
    1. Redis 记录失败次数（cb:{service}:fails）和打开状态（cb:{service}:open）
    2. 失败次数达到阈值 → 设置 OPEN 状态（带 TTL=恢复时间）
    3. OPEN 状态下请求直接拒绝（CircuitBreakerOpenError）
    4. TTL 到期后自动允许探测（HALF_OPEN）
    5. 探测期间用 SET NX 加锁，限制只放行 1 个并发探测请求（避免雪崩）
    6. 探测成功 → 重置计数器（CLOSED）
    7. 探测失败 → 重新打开（OPEN）

使用方式：
    breaker = CircuitBreaker("llm")
    if breaker.is_open():
        raise CircuitBreakerOpenError("LLM 服务熔断中")
    try:
        result = call_llm()
        breaker.record_success()
    except Exception:
        breaker.record_failure()
        raise
"""


import logging
import time
import threading
from typing import Optional

from app.core.config import settings
from app.core.redis import RedisManager, RedisKeys, redis_client

logger = logging.getLogger(__name__)


# ============================================
# 异常定义
# ============================================

class CircuitBreakerOpenError(Exception):
    """
    熔断器打开异常

    作用：
        熔断器处于 OPEN 状态时抛出，表示服务不可用，应快速失败或走降级路径。
        此异常不应被重试逻辑捕获（它是"主动熔断"信号，不是瞬时故障）。
    """

    def __init__(self, service: str, retry_after: int):
        self.service = service
        self.retry_after = retry_after
        super().__init__(
            f"熔断器已打开：服务 {service} 暂时不可用，"
            f"约 {retry_after} 秒后尝试恢复"
        )


# ============================================
# 熔断器实现
# ============================================

class CircuitBreaker:
    """
    单服务熔断器

    作用：
        为单个依赖服务（如 LLM、Embedding）提供熔断保护。

    状态机：
        CLOSED  --失败达阈值-->  OPEN
        OPEN    --TTL 到期-->    HALF_OPEN
        HALF_OPEN --探测成功-->  CLOSED
        HALF_OPEN --探测失败-->  OPEN

    使用方式：
        breaker = CircuitBreaker("llm")
        # 方式1：手动调用
        if breaker.is_open():
            raise CircuitBreakerOpenError(...)
        try:
            result = call()
            breaker.record_success()
        except Exception:
            breaker.record_failure()
            raise

        # 方式2：上下文管理器（推荐）
        with breaker:
            result = call()  # 失败自动 record_failure，成功自动 record_success
    """

    # 熔断器状态常量
    STATE_CLOSED = "closed"
    STATE_OPEN = "open"
    STATE_HALF_OPEN = "half_open"

    def __init__(
        self,
        service: str,
        threshold: Optional[int] = None,
        recovery_time: Optional[int] = None,
    ):
        """
        初始化熔断器

        作用：
            为指定服务创建熔断器实例。

        参数：
            service: str - 服务名称（如 "llm", "embedding"），用于 Redis key 隔离
            threshold: Optional[int] - 连续失败阈值，None 时用全局配置
            recovery_time: Optional[int] - 熔断恢复时间（秒），None 时用全局配置
        """
        self.service = service
        self.threshold = threshold or settings.CIRCUIT_BREAKER_THRESHOLD
        self.recovery_time = recovery_time or settings.CIRCUIT_BREAKER_RECOVERY_TIME

    # ============================================
    # Redis key 构建
    # ============================================

    @property
    def _open_key(self) -> str:
        """OPEN 状态标记 key（存在即表示熔断中，带 TTL=恢复时间）"""
        return RedisKeys.circuit_breaker(f"{self.service}:open")

    @property
    def _fails_key(self) -> str:
        """失败计数 key（CLOSED 状态下累计，成功时清零）"""
        return RedisKeys.circuit_breaker(f"{self.service}:fails")

    @property
    def _probe_key(self) -> str:
        """
        HALF_OPEN 探测锁 key

        作用：
            半开状态下，用 SET NX 保证只有一个请求作为"探测"放行，
            其他请求继续被拒绝，避免恢复瞬间雪崩。
        """
        return RedisKeys.circuit_breaker(f"{self.service}:probe")

    # ============================================
    # 状态查询
    # ============================================

    def get_state(self) -> str:
        """
        获取当前熔断状态

        作用：
            返回熔断器的逻辑状态，便于日志和监控。

        实现方式：
            - open key 存在 → OPEN
            - open key 不存在但 probe key 存在 → HALF_OPEN
            - 都不存在 → CLOSED

        返回:
            str - "closed" / "open" / "half_open"
        """
        if RedisManager.exists(self._open_key):
            return self.STATE_OPEN
        if RedisManager.exists(self._probe_key):
            return self.STATE_HALF_OPEN
        return self.STATE_CLOSED

    def is_open(self) -> bool:
        """
        判断是否应拒绝请求（熔断中）

        作用：
            调用方在发起请求前调用此方法判断是否快速失败。

        实现方式：
            1. 如果 OPEN 状态（open key 存在）→ 拒绝
            2. 如果 CLOSED 状态 → 放行
            3. 如果处于 OPEN→CLOSED 过渡（open key 刚过期）：
               尝试获取探测锁（SET NX），成功则放行该请求作为探测（HALF_OPEN），
               失败说明已有其他请求在探测 → 拒绝

        返回:
            bool - True 表示熔断中应拒绝，False 表示可放行
        """
        # OPEN：open key 存在，直接拒绝
        if RedisManager.exists(self._open_key):
            return True

        # CLOSED：两个 key 都不存在，正常放行
        if not RedisManager.exists(self._fails_key):
            return False

        # 此处 open key 不存在，但 fails 计数存在 → 可能是刚从 OPEN 恢复
        # 尝试进入 HALF_OPEN：获取探测锁
        # 作用：限制只有 1 个请求作为探测，其余继续拒绝
        # M-16 修复：探测锁 TTL 使用 LLM_TIMEOUT 但上限 60s，避免 LLM_TIMEOUT 过大时
        # 探测请求因进程崩溃/网络中断未正常释放锁，导致长时间无法再次探测
        probe_ttl = min(max(settings.LLM_TIMEOUT, 30), 60)
        full_probe_key = RedisManager.make_key(self._probe_key)
        acquired = redis_client.set(full_probe_key, "1", ex=probe_ttl, nx=True)
        # acquired 为 True 表示拿到锁（当前请求作为探测，放行）
        # acquired 为 None 表示锁已被占（已有探测在飞行，拒绝）
        return not bool(acquired)

    def get_retry_after(self) -> int:
        """
        获取熔断剩余恢复时间（秒）

        作用：
            返回距离熔断器自动恢复的时间，用于错误响应中告知客户端。
        """
        full_key = RedisManager.make_key(self._open_key)
        ttl = redis_client.ttl(full_key)
        return max(0, ttl) if ttl and ttl > 0 else self.recovery_time

    # ============================================
    # 结果记录
    # ============================================

    def record_success(self) -> None:
        """
        记录一次成功调用

        作用：
            调用成功后重置失败计数，并清除探测锁（若处于 HALF_OPEN 则恢复为 CLOSED）。

        实现方式：
            - 删除 fails 计数
            - 删除 probe 锁（HALF_OPEN 探测成功 → CLOSED）
        """
        try:
            RedisManager.delete(self._fails_key)
            RedisManager.delete(self._probe_key)
        except Exception as e:
            logger.error(f"[熔断器:{self.service}] record_success 失败: {e}")

    def record_failure(self) -> None:
        """
        记录一次失败调用

        作用：
            调用失败后递增失败计数，达到阈值则打开熔断器。
            若处于 HALF_OPEN（探测失败）则立即重新打开。

        实现方式：
            1. 若 probe key 存在（HALF_OPEN 探测失败）→ 直接重新 OPEN，清探测锁
            2. 否则（CLOSED 累计失败）→ INCR fails，达阈值则 OPEN
        """
        try:
            # HALF_OPEN 探测失败：立即重新打开
            if RedisManager.exists(self._probe_key):
                self._open()
                RedisManager.delete(self._probe_key)
                logger.warning(
                    f"[熔断器:{self.service}] HALF_OPEN 探测失败，重新打开熔断 "
                    f"{self.recovery_time}s"
                )
                return

            # CLOSED 状态：累计失败次数
            # fails 计数 TTL 设为恢复时间，作为失败统计窗口
            count = RedisManager.increment(
                self._fails_key,
                ttl=self.recovery_time,
            )

            if count >= self.threshold:
                self._open()
                logger.warning(
                    f"[熔断器:{self.service}] 连续失败 {count} 次达到阈值 "
                    f"{self.threshold}，打开熔断 {self.recovery_time}s"
                )
        except Exception as e:
            logger.error(f"[熔断器:{self.service}] record_failure 失败: {e}")

    def _open(self) -> None:
        """
        打开熔断器

        作用：
            设置 OPEN 状态标记（带 TTL=恢复时间），到期后自动恢复。
            同时清除失败计数（OPEN 期间不再累计）。
        """
        RedisManager.set(self._open_key, str(int(time.time())), ttl=self.recovery_time)
        RedisManager.delete(self._fails_key)

    # ============================================
    # 上下文管理器（推荐用法）
    # ============================================

    def __enter__(self):
        """
        进入上下文：检查熔断状态

        作用：
            调用前检查熔断器，若 OPEN 则抛 CircuitBreakerOpenError。

        异常:
            CircuitBreakerOpenError - 熔断器打开时抛出
        """
        if self.is_open():
            raise CircuitBreakerOpenError(self.service, self.get_retry_after())
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        退出上下文：根据是否异常记录成功/失败

        作用：
            - 无异常 → record_success
            - 有异常 → record_failure（异常仍会向上抛出）
        """
        if exc_type is None:
            self.record_success()
        else:
            self.record_failure()
        # 返回 False 表示不吞掉异常，继续向上传播
        return False


# ============================================
# 全局熔断器实例（按服务名复用）
# ============================================

# M-24 修复：_breakers 字典加线程锁，防止多线程并发创建重复实例
_breakers: dict = {}
_breakers_lock = threading.Lock()


def get_circuit_breaker(service: str) -> CircuitBreaker:
    """
    获取服务的熔断器实例（单例，线程安全）

    作用：
        每个服务共享一个熔断器实例，避免重复创建和状态分散。
        M-24 修复：使用 threading.Lock 保护 _breakers 字典，防止多线程
        并发时为同一服务创建多个实例（原实现 check-then-create 存在竞态）。

    参数：
        service: str - 服务名称（如 "llm", "embedding"）

    返回:
        CircuitBreaker - 熔断器实例
    """
    # 双重检查锁定模式（double-checked locking）
    # 作用：已存在时无需加锁，避免性能损耗；仅创建时加锁
    if service not in _breakers:
        with _breakers_lock:
            if service not in _breakers:
                _breakers[service] = CircuitBreaker(service)
    return _breakers[service]
