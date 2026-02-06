# Tracelet Python SDK

Auto-instrumentation and local evaluation engine for the [Tracelet VS Code extension](https://github.com/satwiksps/tracelet).

## Installation

```bash
pip install tracelet-sdk
```

## Quick Start

Initialize the SDK at the entry point of your application:

```python
import tracelet
tracelet.init()

from openai import OpenAI
client = OpenAI()

# This call is automatically traced and saved locally!
client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

The SDK automatically intercepts `openai` and `anthropic` calls, writing standard OpenTelemetry JSON files to `.tracelet/traces/` in your workspace. The VS Code extension automatically discovers and visualizes these traces.

## LangChain Integration

If you use LangChain, use the `TraceletCallbackHandler`:

```python
from langchain_openai import ChatOpenAI
from tracelet import TraceletCallbackHandler

llm = ChatOpenAI(callbacks=[TraceletCallbackHandler()])
llm.invoke("What is attention?")
```

## Tracing Custom Functions

Use the `@trace` decorator to capture custom pipeline steps like vector retrieval:

```python
from tracelet import trace

@trace(kind="retriever")
def search_documents(query: str):
    # your vector db logic here
    pass
```

## Local Evaluation Engine

Use `@tracelet.eval` with `pytest` to score your traces locally:

```python
from tracelet import eval

def check_no_hallucinations(trace_data):
    # Your LLM-as-a-judge logic
    return 1.0

@eval(metric=check_no_hallucinations)
def test_rag_pipeline():
    result = run_pipeline("How does attention work?")
    assert result
```
