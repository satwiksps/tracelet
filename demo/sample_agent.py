"""
Sample Agent with Tool Calling — Tracelet Demo
=================================================

This file demonstrates a typical agentic workflow with tool-calling.
Tracelet's CodeLens detects the Anthropic SDK invocations and maps
runtime traces back to these exact line numbers.
"""

import anthropic

client = anthropic.Anthropic()

TOOLS = [
    {"name": "web_search", "description": "Search the web for information"},
    {"name": "calculator", "description": "Evaluate mathematical expressions"},
    {"name": "code_interpreter", "description": "Execute Python code"},
]


# ─── Step 1: Plan action (LLM decides which tools to use) ───────────────────

def plan_action(query: str) -> dict:
    """Ask Claude to analyze the request and select tools."""
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=2048,
        temperature=0.1,
        system="You are a research assistant agent. Analyze the user's request and decide which tools to use.",
        messages=[{"role": "user", "content": query}],
        tools=TOOLS,
    )
    return response


# ─── Step 2: Execute tool calls ─────────────────────────────────────────────

def web_search(query: str) -> str:
    """Execute a web search tool call."""
    # In production: calls a search API like Tavily, Serper, or Brave
    return f"Search results for: {query}"


def calculator(expression: str) -> str:
    """Evaluate a mathematical expression."""
    return str(eval(expression))


# ─── Step 3: Parse and structure results ─────────────────────────────────────

def parse_results(raw_results: list[str]) -> dict:
    """Parse raw tool outputs into structured data."""
    return {
        "nvidia_market_cap": "$4.2T",
        "apple_market_cap": "$3.8T",
        "parsed_count": len(raw_results),
    }


# ─── Step 4: Synthesize final response ──────────────────────────────────────

def synthesize_response(parsed_data: dict, original_query: str) -> str:
    """Generate a final response using the parsed tool outputs."""
    context = "\n".join(f"- {k}: {v}" for k, v in parsed_data.items())

    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        temperature=0.2,
        system="Synthesize the search results into a clear, factual response.",
        messages=[
            {"role": "user", "content": f"Data:\n{context}\n\nQuestion: {original_query}"},
        ],
    )
    return response.content[0].text


# ─── Agent Orchestrator ──────────────────────────────────────────────────────

def agent_run(query: str) -> str:
    """Full agent loop: plan → execute tools → parse → synthesize."""
    plan = plan_action(query)

    # Execute tool calls from the plan
    results = []
    for tool_use in plan.content:
        if tool_use.type == "tool_use":
            if tool_use.name == "web_search":
                results.append(web_search(tool_use.input["query"]))
            elif tool_use.name == "calculator":
                results.append(calculator(tool_use.input["expression"]))

    parsed = parse_results(results)
    answer = synthesize_response(parsed, query)
    return answer


if __name__ == "__main__":
    result = agent_run(
        "What is the current market cap of NVIDIA and how does it compare to Apple?"
    )
    print(result)
