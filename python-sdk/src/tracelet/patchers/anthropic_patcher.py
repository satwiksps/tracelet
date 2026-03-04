from ..span import Span

_original_create = None

def patch_anthropic():
    global _original_create
    try:
        from anthropic.resources.messages import Messages
        if not hasattr(Messages, "create"):
            return
            
        _original_create = Messages.create
        
        def _patched_create(self, *args, **kwargs):
            span = Span(name="Messages", kind="llm")
            span.set_attribute("llm.provider", "anthropic")
            span.set_attribute("llm.model", kwargs.get("model", "unknown"))
            
            # Capture inputs
            messages = kwargs.get("messages", [])
            system = kwargs.get("system", "")
            
            idx = 0
            if system:
                span.set_attribute(f"llm.input_messages.{idx}.message.role", "system")
                span.set_attribute(f"llm.input_messages.{idx}.message.content", system)
                idx += 1
                
            for msg in messages:
                role = msg.get("role", "")
                content = msg.get("content", "")
                if isinstance(content, list):
                    # handle rich content if necessary, for now simplify to str
                    content = str(content)
                span.set_attribute(f"llm.input_messages.{idx}.message.role", role)
                span.set_attribute(f"llm.input_messages.{idx}.message.content", content)
                idx += 1
                
            span.start()
            try:
                result = _original_create(self, *args, **kwargs)
                
                # Capture outputs
                if hasattr(result, "content") and result.content:
                    content_text = ""
                    for block in result.content:
                        if hasattr(block, "text"):
                            content_text += block.text
                    span.set_attribute("llm.output_messages.0.message.role", "assistant")
                    span.set_attribute("llm.output_messages.0.message.content", content_text)
                    
                # Capture token usage
                if hasattr(result, "usage") and result.usage:
                    span.set_attribute("llm.token_count.prompt", result.usage.input_tokens)
                    span.set_attribute("llm.token_count.completion", result.usage.output_tokens)
                    span.set_attribute("llm.token_count.total", result.usage.input_tokens + result.usage.output_tokens)
                    
                return result
            except Exception as e:
                span.record_error(e)
                raise
            finally:
                span.end()
                
        Messages.create = _patched_create
    except Exception:
        pass
