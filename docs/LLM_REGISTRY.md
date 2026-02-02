# LLM Registry

This document lists all Large Language Model (LLM) providers, API keys, and model configurations used in the application.

## 1. Provider Keys (Environment Variables)

These keys must be set in your `.env` file to enable the respective providers.

| Provider | Environment Variable | Criticality | Notes |
| :--- | :--- | :--- | :--- |
| **OpenAI** | `OPENAI_API_KEY` | **Critical** | Required for embeddings, memory extraction, and fallback generation. |
| **Anthropic** | `ANTHROPIC_API_KEY` | High | Required for `claude-sonnet-4-5-20250929` (default agent model). |
| **Google** | `GOOGLE_API_KEY` | Medium | Required for Gemini models (`gemini-2.0-flash`). |
| **Groq** | `GROQ_API_KEY` | Medium | Required for fast inference (`llama-3.3-70b-versatile`). |
| **OpenRouter** | `OPENROUTER_API_KEY` | High | Fallback backup model and flexible routing. |
| **AI Gateway** | `AI_GATEWAY_API_KEY` | Low | Optional gateway wrapper. |
| **Perplexity** | `PERPLEXITY_API_KEY` | Low | Optional for search-grounded queries. |
| **Bedrock** | `BEDROCK_ACCESS_KEY` | Low | AWS Bedrock authentication. |
| **Bedrock** | `BEDROCK_SECRET_KEY` | Low | AWS Bedrock authentication. |
| **Bedrock** | `BEDROCK_REGION` | Low | AWS Region (default: `us-west-2`). |
| **Ollama** | `OLLAMA_BASE_URL` | Local | For local model inference. |

## 2. Model Configuration (Environment Variables)

These variables control which models are used for specific tasks.

| Config Variable | Default Value | Description |
| :--- | :--- | :--- |
| `DEFAULT_LLM_PROVIDER` | `anthropic` | The primary provider for general tasks. |
| `DEFAULT_LLM_MODEL` | (Optional) | Override the specific model name for the default provider. |
| `ECONOMY_LLM_PROVIDER` | (Optional) | Provider for high-volume/background tasks (e.g., summarization). |
| `ECONOMY_LLM_MODEL` | (Optional) | Specific economny model name. |
| `CHAT_LLM_PROVIDER` | (Optional) | Provider for low-latency chat interactions. |
| `CHAT_LLM_MODEL` | (Optional) | Specific chat model name. |
| `OPENROUTER_BACKUP_MODEL`| `google/gemini-2.5-flash` | Fallback model if the primary fails. |
| `USE_BACKUP_MODEL` | `false` | Force usage of backup model. |

## 3. Hardcoded / Default Models

If environment variables are not set, the code defaults to these specific model versions (`src/server/lib/llms/model.ts`).

| Provider | Default Model ID | Usage |
| :--- | :--- | :--- |
| **OpenAI** | `gpt-5.1` | General purpose (if OpenAI selected). |
| **OpenAI** | `gpt-4o-mini` | Economy model for memory extraction. |
| **OpenAI** | `text-embedding-3-small` | Vector embeddings for semantic search. |
| **Anthropic** | `claude-sonnet-4-5-20250929` | **Project Default** |
| **Google** | `gemini-2.0-flash` | Economy / Fast tasks. |
| **Groq** | `llama-3.3-70b-versatile` | Ultra-fast agentic steps. |
| **OpenRouter**| `anthropic/claude-sonnet-4.5` | Routing layer. |
| **Bedrock** | `global.anthropic.claude-sonnet-4-5-20250929-v1:0`| Enterprise fallback. |

## 4. Specific Task Assignments

| Task | Recommended Configuration | Reason |
| :--- | :--- | :--- |
| **Agent Loop** | Anthropic (`claude-sonnet`) | Best reasoning/coding capability. |
| **Memory Recording** | OpenAI (`gpt-4o-mini`) | Fast, cheap, good at structured extraction. |
| **Summarization** | OpenAI (`gpt-4o-mini`) | Low cost for background jobs. |
| **Embeddings** | OpenAI (`text-embedding-3-small`) | 1536-dim vectors, $0.02/1M tokens. |
| **Notifications** | Groq (`llama-3`) or Gemini Flash | **Lowest latency** for push alerts. |

## 5. Embedding Model Details

The embedding model is critical for semantic search in the context/memory system.

| Property | Value |
| :--- | :--- |
| **Model** | `text-embedding-3-small` |
| **Provider** | OpenAI |
| **Dimensions** | 1536 |
| **Max Input** | 8,191 tokens (~30,000 characters) |
| **Cost** | $0.02 per 1M tokens |
| **Used For** | MemoryFact search, Knowledge retrieval, Rule matching |

**Implementation**: `src/server/features/embeddings/service.ts`

## 6. Memory System Models

The Memory Recording System uses economy models for cost-effective fact extraction.

| Component | Model | Cost | Trigger |
| :--- | :--- | :--- | :--- |
| **Memory Recording** | `gpt-4o-mini` | $0.15/1M in, $0.60/1M out | 120K tokens accumulated |
| **Fact Extraction** | `gpt-4o-mini` | (same) | Part of memory recording |
| **Embedding Generation** | `text-embedding-3-small` | $0.02/1M tokens | Per fact/knowledge item |

**Implementation**: 
- Recording: `src/app/api/jobs/record-memory/route.ts`
- Service: `src/server/features/summaries/service.ts`
- Embeddings: `src/server/features/embeddings/service.ts`
