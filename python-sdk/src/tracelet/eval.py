from functools import wraps
from .span import Span
from .context import get_current_trace_id

def eval(metric):
    """
    Decorator for tests. Runs the test, captures the trace_id, 
    then runs the metric function on the trace and appends an evaluator span.
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Run the test function (it should generate traces)
            result = func(*args, **kwargs)
            
            # The test function should have generated a trace.
            # Usually the test itself is the root of the trace if we wrapped it.
            # If not, this is a simplified version.
            trace_id = get_current_trace_id()
            if not trace_id:
                # If the test function wasn't traced itself, we can't easily 
                # link the eval span. In a real framework, we'd ensure tests are traced.
                pass
                
            # Create an evaluator span
            eval_span = Span(name=metric.__name__, kind="evaluator")
            eval_span.start()
            try:
                # In a full implementation, we'd pass the full trace data to the metric
                score = metric(result)
                eval_span.set_attribute("evaluator.score", score)
                eval_span.status = "success"
            except Exception as e:
                eval_span.record_error(e)
            finally:
                eval_span.end()
                
            return result
        return wrapper
    return decorator
