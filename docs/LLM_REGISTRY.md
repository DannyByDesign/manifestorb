# LLM Registry

This document lists the LLM providers and model configuration used for the Google + OpenAI MVP.

## 1. Provider Keys (Environment Variables)

| Provider | Environment Variable | Criticality | Notes |
| :--- | :--- | :--- | :--- |
| **Google** | `GOOGLE_API_KEY` | **Critical** | Required for Gemini models (primary provider). |
| **OpenAI** | `OPENAI_API_KEY` | **Critical** | Required for embeddings only. |

## 2. Model Configuration (Environment Variables)

| Config Variable | Default Value | Description |
| :--- | :--- | :--- |
| `DEFAULT_LLM_PROVIDER` | `google` | Primary provider for general tasks. |
| `DEFAULT_LLM_MODEL` | `gemini-2.5-flash` | Default model for base tier. |
| `ECONOMY_LLM_PROVIDER` | (Optional) | Provider for high-volume/background tasks. |
| `ECONOMY_LLM_MODEL` | (Optional) | Specific economy model name. |
| `CHAT_LLM_PROVIDER` | (Optional) | Provider for low-latency chat. |
| `CHAT_LLM_MODEL` | (Optional) | Specific chat model name. |
| `USE_BACKUP_MODEL` | `false` | Force usage of backup model if set. |

## 3. Default Models

| Provider | Default Model ID | Usage |
| :--- | :--- | :--- |
| **Google** | `gemini-2.5-flash` | General purpose tasks. |
| **OpenAI** | `text-embedding-3-small` | Embeddings only. |
| **OpenAI** | `text-embedding-3-small` | Vector embeddings for semantic search. |

## 4. Task Assignments (MVP)

| Task | Provider / Model | Reason |
| :--- | :--- | :--- |
| **Agent Loop** | Google (`gemini-2.5-flash`) | Cost-effective general reasoning. |
| **Memory Recording** | Google (`gemini-2.5-flash`) | Fast, cost-effective extraction. |
| **Summarization** | Google (`gemini-2.5-flash`) | Cost-effective background jobs. |
| **Embeddings** | OpenAI (`text-embedding-3-small`) | Standard embeddings for memory/knowledge. |

## 5. Embedding Model Details

| Property | Value |
| :--- | :--- |
| **Model** | `text-embedding-3-small` |
| **Provider** | OpenAI |
| **Dimensions** | 1536 |
| **Max Input** | 8,191 tokens (~30,000 characters) |
| **Used For** | MemoryFact search, Knowledge retrieval, Rule matching |

**Implementation**: `src/server/features/embeddings/service.ts`

## 6. Memory System Models

| Component | Model | Trigger |
| :--- | :--- | :--- |
| **Memory Recording** | `gemini-2.5-flash` | 120K tokens accumulated |
| **Fact Extraction** | `gemini-2.5-flash` | Part of memory recording |
| **Embedding Generation** | `text-embedding-3-small` | Per fact/knowledge item |

**Implementation**:
- Recording: `src/app/api/jobs/record-memory/route.ts`
- Service: `src/server/features/summaries/service.ts`
- Embeddings: `src/server/features/embeddings/service.ts`
