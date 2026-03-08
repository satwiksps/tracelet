from typing import Dict, Any, List, Optional
import uuid
from .span import Span

try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.outputs import LLMResult
    from langchain_core.messages import BaseMessage
    from langchain_core.documents import Document
except ImportError:
    class BaseCallbackHandler:
        pass
    class LLMResult:
        pass
    class BaseMessage:
        pass
    class Document:
        pass

class TraceletCallbackHandler(BaseCallbackHandler):
    """
    LangChain callback handler that writes traces to the local OTLP file.
    """
    def __init__(self):
        self.spans = {}
        
    def _create_span(self, run_id: uuid.UUID, name: str, kind: str) -> Span:
        span = Span(name=name, kind=kind)
        # LangChain doesn't easily let us inspect the stack of the user's code 
        # from inside a callback, so we might miss code.filepath unless we walk very far.
        # But this is a good start.
        span.start()
        self.spans[str(run_id)] = span
        return span
        
    def _end_span(self, run_id: uuid.UUID, error: Exception = None):
        span = self.spans.get(str(run_id))
        if span:
            if error:
                span.record_error(error)
            span.end()
            del self.spans[str(run_id)]

    def on_llm_start(self, serialized: Dict[str, Any], prompts: List[str], *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
        span = self._create_span(run_id, "LLM", "llm")
        if prompts:
            span.set_attribute("llm.input_messages.0.message.role", "user")
            span.set_attribute("llm.input_messages.0.message.content", prompts[0])

    def on_chat_model_start(self, serialized: Dict[str, Any], messages: List[List[BaseMessage]], *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
        span = self._create_span(run_id, "ChatModel", "llm")
        if messages and len(messages) > 0:
            for i, msg in enumerate(messages[0]):
                span.set_attribute(f"llm.input_messages.{i}.message.role", msg.type)
                span.set_attribute(f"llm.input_messages.{i}.message.content", msg.content)

    def on_llm_end(self, response: LLMResult, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        span = self.spans.get(str(run_id))
        if span and response.generations and len(response.generations) > 0:
            gen = response.generations[0][0]
            span.set_attribute("llm.output_messages.0.message.role", "assistant")
            span.set_attribute("llm.output_messages.0.message.content", gen.text)
            
            if response.llm_output and "token_usage" in response.llm_output:
                usage = response.llm_output["token_usage"]
                span.set_attribute("llm.token_count.prompt", usage.get("prompt_tokens", 0))
                span.set_attribute("llm.token_count.completion", usage.get("completion_tokens", 0))
                span.set_attribute("llm.token_count.total", usage.get("total_tokens", 0))
                
        self._end_span(run_id)

    def on_llm_error(self, error: BaseException, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id, error)

    def on_chain_start(self, serialized: Dict[str, Any], inputs: Dict[str, Any], *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
        name = serialized.get("name", "Chain")
        self._create_span(run_id, name, "chain")

    def on_chain_end(self, outputs: Dict[str, Any], *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id)

    def on_chain_error(self, error: BaseException, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id, error)

    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
        name = serialized.get("name", "Tool")
        self._create_span(run_id, name, "tool")

    def on_tool_end(self, output: str, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id)

    def on_tool_error(self, error: BaseException, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id, error)

    def on_retriever_start(self, serialized: Dict[str, Any], query: str, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
        name = serialized.get("name", "Retriever")
        span = self._create_span(run_id, name, "retriever")

    def on_retriever_end(self, documents: List[Document], *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id)

    def on_retriever_error(self, error: BaseException, *, run_id: uuid.UUID, parent_run_id: Optional[uuid.UUID] = None, **kwargs: Any) -> Any:
        self._end_span(run_id, error)
