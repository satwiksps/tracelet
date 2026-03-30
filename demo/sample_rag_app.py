"""
Sample RAG Pipeline — Tracelet Demo
====================================

This file demonstrates a typical Retrieval-Augmented Generation pipeline.
Tracelet's CodeLens detects the LLM invocations and maps runtime traces
back to these exact line numbers.

In production, each function here would be instrumented with OpenTelemetry
via @traceable or OpenInference auto-instrumentation.
"""

from openai import OpenAI
import tracelet

# Initialize auto-instrumentation
tracelet.init()

client = OpenAI()


# ─── Stage 1: Embed the user query ──────────────────────────────────────────

def embed_query(query: str) -> list[float]:
    """Generate embedding vector for the user's question."""
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=query,
    )
    return response.data[0].embedding


# ─── Stage 2: Vector similarity search ──────────────────────────────────────

def vector_search(embedding: list[float], top_k: int = 5) -> list[dict]:
    """Query the vector store for relevant documents."""
    # In production: pinecone.query(vector=embedding, top_k=top_k)
    return [
        {"text": "The transformer architecture relies on self-attention...", "score": 0.94},
        {"text": "Multi-head attention allows the model to jointly attend...", "score": 0.91},
        {"text": "The scaled dot-product attention is computed as...", "score": 0.87},
    ]


# ─── Stage 3: Rerank retrieved documents ────────────────────────────────────

def rerank_documents(query: str, documents: list[dict], top_k: int = 3) -> list[dict]:
    """Rerank documents using a cross-encoder for better relevance."""
    # In production: cohere.rerank(query=query, documents=docs)
    sorted_docs = sorted(documents, key=lambda d: d["score"], reverse=True)
    return sorted_docs[:top_k]


# ─── Stage 4: Format context for the prompt ─────────────────────────────────

def format_context(documents: list[dict]) -> str:
    """Combine retrieved documents into a context string."""
    return "\n\n".join(doc["text"] for doc in documents)


# ─── Stage 5: Generate the final answer (LLM call) ──────────────────────────

SYSTEM_PROMPT_TEMPLATE = """You are an expert AI researcher. Use the following context to answer the user's question accurately and concisely.

---
Context:
{context}
---

{system_instruction}"""


def generate_answer(query: str, context: str) -> str:
    """Call GPT-4o with the hydrated prompt template."""
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        context=context,
        system_instruction="Provide clear explanations with examples where helpful.",
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        temperature=0.3,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query},
        ],
    )
    return response.choices[0].message.content


# ─── Pipeline Orchestrator ───────────────────────────────────────────────────

def rag_pipeline(query: str) -> str:
    """End-to-end RAG pipeline: embed → search → rerank → format → generate."""
    embedding = embed_query(query)
    documents = vector_search(embedding)
    reranked = rerank_documents(query, documents)
    context = format_context(reranked)
    answer = generate_answer(query, context)
    return answer


if __name__ == "__main__":
    result = rag_pipeline("How does transformer attention mechanism work?")
    print(result)
