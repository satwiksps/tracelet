from functools import wraps
from .span import Span

def trace(kind: str = "chain", name: str = None):
    """
    Decorator to trace a function execution.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            span_name = name or func.__name__
            span = Span(name=span_name, kind=kind)
            span.start()
            try:
                result = func(*args, **kwargs)
                return result
            except Exception as e:
                span.record_error(e)
                raise
            finally:
                span.end()
        return wrapper
    return decorator
