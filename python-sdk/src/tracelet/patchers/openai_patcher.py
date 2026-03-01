import json
from ..span import Span

_original_create = None

def patch_openai():
    global _original_create
    try:
        from openai.resources.chat.completions import Completions
        if not hasattr(Completions, "create"):
            return
            
        _original_create = Completions.create
        
        def _patched_create(self, *args, **kwargs):
            span = Span(name="ChatCompletion", kind="llm")
            span.set_attribute("llm.provider", "openai")
            span.set_attribute("llm.model", kwargs.get("model", "unknown"))
            
            # Capture inputs
            messages = kwargs.get("messages", [])
            for i, msg in enumerate(messages):
                role = msg.get("role", "")
                content = msg.get("content", "")
                span.set_attribute(f"llm.input_messages.{i}.message.role", role)
                span.set_attribute(f"llm.input_messages.{i}.message.content", content)
                
            span.start()
            try:
                result = _original_create(self, *args, **kwargs)
                
                # Capture outputs
                if hasattr(result, "choices") and result.choices:
                    choice = result.choices[0]
                    msg = choice.message
                    span.set_attribute("llm.output_messages.0.message.role", msg.role)
                    span.set_attribute("llm.output_messages.0.message.content", msg.content or "")
                    
                # Capture token usage
                if hasattr(result, "usage") and result.usage:
                    span.set_attribute("llm.token_count.prompt", result.usage.prompt_tokens)
                    span.set_attribute("llm.token_count.completion", result.usage.completion_tokens)
                    span.set_attribute("llm.token_count.total", result.usage.total_tokens)
                    
                return result
            except Exception as e:
                span.record_error(e)
                raise
            finally:
                span.end()
                
        Completions.create = _patched_create
    except Exception:
        pass
