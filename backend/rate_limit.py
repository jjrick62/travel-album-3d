"""简易 IP 级别频率限制器（内存存储，进程重启清空）"""
import time
from collections import defaultdict

# 默认配置
MAX_REQUESTS = 5       # 最大请求次数
WINDOW_SECONDS = 3600  # 时间窗口（1 小时）

# { ip: [timestamp, timestamp, ...] }
_store = defaultdict(list)


def _cleanup(now: float) -> None:
    """全局清理过期记录（每次 check 时惰性清理）"""
    for ip in list(_store.keys()):
        _store[ip] = [t for t in _store[ip] if now - t < WINDOW_SECONDS]
        if not _store[ip]:
            del _store[ip]


def check(ip: str, max_requests: int = MAX_REQUESTS,
          window: int = WINDOW_SECONDS) -> tuple[bool, int]:
    """检查 IP 是否超过频率限制。

    Returns:
        (allowed, remaining) — allowed 为 True 表示允许请求
    """
    now = time.time()
    _cleanup(now)

    timestamps = _store[ip]
    # 只保留窗口内的请求
    recent = [t for t in timestamps if now - t < window]
    count = len(recent)

    if count >= max_requests:
        oldest = recent[0]
        wait = int(window - (now - oldest))
        return False, wait

    recent.append(now)
    _store[ip] = recent
    remaining = max_requests - len(recent)
    return True, remaining


def reset(ip: str = None) -> None:
    """重置指定 IP 的记录（不传参数则清空全部，用于测试）"""
    if ip:
        _store.pop(ip, None)
    else:
        _store.clear()
