# Backboard Python SDK Reference

- Generated: 2026-02-19T01:16:04.581993+00:00
- SDK version: `1.5.0`
- Source: installed package introspection (`backboard`)

## Top-Level Exports (`backboard`)

- `BackboardClient`
- `DocumentStatus`
- `MessageRole`
- `Assistant`
- `Thread`
- `Document`
- `Message`
- `ToolDefinition`
- `FunctionDefinition`
- `ToolParameters`
- `ToolParameterProperties`
- `ToolCall`
- `ToolCallFunction`
- `AttachmentInfo`
- `MessageResponse`
- `ToolOutputsResponse`
- `SubmitToolOutputsRequest`
- `ToolOutput`
- `Memory`
- `MemoryCreate`
- `MemoryUpdate`
- `MemoriesListResponse`
- `MemoryStats`
- `BackboardError`
- `BackboardAPIError`
- `BackboardValidationError`
- `BackboardNotFoundError`
- `BackboardRateLimitError`
- `BackboardServerError`

## `BackboardClient`

- Constructor: `BackboardClient(api_key: str, base_url: str = 'https://app.backboard.io/api', timeout: int = 30)`

### Methods

#### `aclose(self) -> None`

#### `add_memory(self, assistant_id: Union[str, uuid.UUID], content: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]`
- Add a new memory to an assistant.

#### `add_message(self, thread_id: Union[str, uuid.UUID], content: Optional[str] = None, files: Optional[List[Union[str, pathlib.Path]]] = None, llm_provider: Optional[str] = None, model_name: Optional[str] = None, stream: bool = False, memory: Optional[str] = None) -> Union[backboard.models.MessageResponse, AsyncIterator[Dict[str, Any]]]`

#### `create_assistant(self, name: str, description: Optional[str] = None, tools: Optional[List[Union[backboard.models.ToolDefinition, Dict[str, Any]]]] = None, embedding_provider: Optional[str] = None, embedding_model_name: Optional[str] = None, embedding_dims: Optional[int] = None) -> backboard.models.Assistant`

#### `create_thread(self, assistant_id: Union[str, uuid.UUID]) -> backboard.models.Thread`

#### `delete_assistant(self, assistant_id: Union[str, uuid.UUID]) -> Dict[str, Any]`

#### `delete_document(self, document_id: Union[str, uuid.UUID]) -> Dict[str, Any]`

#### `delete_memory(self, assistant_id: Union[str, uuid.UUID], memory_id: str) -> Dict[str, Any]`
- Delete a memory.

#### `delete_thread(self, thread_id: Union[str, uuid.UUID]) -> Dict[str, Any]`

#### `get_assistant(self, assistant_id: Union[str, uuid.UUID]) -> backboard.models.Assistant`

#### `get_document_status(self, document_id: Union[str, uuid.UUID]) -> backboard.models.Document`

#### `get_memories(self, assistant_id: Union[str, uuid.UUID]) -> backboard.models.MemoriesListResponse`
- Get all memories for an assistant.

#### `get_memory(self, assistant_id: Union[str, uuid.UUID], memory_id: str) -> backboard.models.Memory`
- Get a specific memory by ID.

#### `get_memory_stats(self, assistant_id: Union[str, uuid.UUID]) -> backboard.models.MemoryStats`
- Get memory statistics for an assistant.

#### `get_thread(self, thread_id: Union[str, uuid.UUID]) -> backboard.models.Thread`

#### `list_assistant_documents(self, assistant_id: Union[str, uuid.UUID]) -> List[backboard.models.Document]`

#### `list_assistants(self, skip: int = 0, limit: int = 100) -> List[backboard.models.Assistant]`

#### `list_thread_documents(self, thread_id: Union[str, uuid.UUID]) -> List[backboard.models.Document]`

#### `list_threads(self, skip: int = 0, limit: int = 100) -> List[backboard.models.Thread]`

#### `list_threads_for_assistant(self, assistant_id: Union[str, uuid.UUID], skip: int = 0, limit: int = 100) -> List[backboard.models.Thread]`

#### `submit_tool_outputs(self, thread_id: Union[str, uuid.UUID], run_id: str, tool_outputs: List[Union[backboard.models.ToolOutput, Dict[str, str]]], stream: bool = False) -> Union[backboard.models.ToolOutputsResponse, AsyncIterator[Dict[str, Any]]]`

#### `update_assistant(self, assistant_id: Union[str, uuid.UUID], name: Optional[str] = None, description: Optional[str] = None, tools: Optional[List[Union[backboard.models.ToolDefinition, Dict[str, Any]]]] = None) -> backboard.models.Assistant`

#### `update_memory(self, assistant_id: Union[str, uuid.UUID], memory_id: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> backboard.models.Memory`
- Update an existing memory.

#### `upload_document_to_assistant(self, assistant_id: Union[str, uuid.UUID], file_path: Union[str, pathlib.Path]) -> backboard.models.Document`

#### `upload_document_to_thread(self, thread_id: Union[str, uuid.UUID], file_path: Union[str, pathlib.Path]) -> backboard.models.Document`

## Models (`backboard.models`)

### `Assistant`
- Assistant model
- Signature: `Assistant(*, assistant_id: uuid.UUID, name: str, description: Optional[str] = None, system_prompt: Optional[str] = None, tools: Optional[List[backboard.models.ToolDefinition]] = None, tok_k: Optional[int] = None, embedding_provider: Optional[str] = None, embedding_model_name: Optional[str] = None, embedding_dims: Optional[int] = None, created_at: datetime.datetime) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `assistant_id` | `<class 'uuid.UUID'>` | `yes` | `—` |
| `created_at` | `<class 'datetime.datetime'>` | `yes` | `—` |
| `description` | `Optional[str]` | `no` | `None` |
| `embedding_dims` | `Optional[int]` | `no` | `None` |
| `embedding_model_name` | `Optional[str]` | `no` | `None` |
| `embedding_provider` | `Optional[str]` | `no` | `None` |
| `name` | `<class 'str'>` | `yes` | `—` |
| `system_prompt` | `Optional[str]` | `no` | `None` |
| `tok_k` | `Optional[int]` | `no` | `None` |
| `tools` | `Optional[List[backboard.models.ToolDefinition]]` | `no` | `None` |

### `AttachmentInfo`
- Message attachment information
- Signature: `AttachmentInfo(*, document_id: uuid.UUID, filename: str, status: str, file_size_bytes: Optional[int] = None, summary: Optional[str] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `document_id` | `<class 'uuid.UUID'>` | `yes` | `—` |
| `file_size_bytes` | `Optional[int]` | `no` | `None` |
| `filename` | `<class 'str'>` | `yes` | `—` |
| `status` | `<class 'str'>` | `yes` | `—` |
| `summary` | `Optional[str]` | `no` | `None` |

### `Document`
- Document model
- Signature: `Document(*, document_id: uuid.UUID, filename: str, status: backboard.models.DocumentStatus, created_at: datetime.datetime, status_message: Optional[str] = None, summary: Optional[str] = None, updated_at: Optional[datetime.datetime] = None, file_size_bytes: Optional[int] = None, total_tokens: Optional[int] = None, chunk_count: Optional[int] = None, processing_started_at: Optional[datetime.datetime] = None, processing_completed_at: Optional[datetime.datetime] = None, document_type: Optional[str] = None, metadata_: Optional[Dict[str, Any]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `chunk_count` | `Optional[int]` | `no` | `None` |
| `created_at` | `<class 'datetime.datetime'>` | `yes` | `—` |
| `document_id` | `<class 'uuid.UUID'>` | `yes` | `—` |
| `document_type` | `Optional[str]` | `no` | `None` |
| `file_size_bytes` | `Optional[int]` | `no` | `None` |
| `filename` | `<class 'str'>` | `yes` | `—` |
| `metadata_` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `processing_completed_at` | `Optional[datetime.datetime]` | `no` | `None` |
| `processing_started_at` | `Optional[datetime.datetime]` | `no` | `None` |
| `status` | `<enum 'DocumentStatus'>` | `yes` | `—` |
| `status_message` | `Optional[str]` | `no` | `None` |
| `summary` | `Optional[str]` | `no` | `None` |
| `total_tokens` | `Optional[int]` | `no` | `None` |
| `updated_at` | `Optional[datetime.datetime]` | `no` | `None` |

### `DocumentStatus`
- Document processing status
- Signature: `DocumentStatus(value, names=None, *, module=None, qualname=None, type=None, start=1)`
- Enum values:
  - `PENDING` = `pending`
  - `PROCESSING` = `processing`
  - `INDEXED` = `indexed`
  - `FAILED` = `failed`

### `FunctionDefinition`
- Function definition for tools
- Signature: `FunctionDefinition(*, name: str, description: Optional[str] = None, parameters: backboard.models.ToolParameters) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `description` | `Optional[str]` | `no` | `None` |
| `name` | `<class 'str'>` | `yes` | `—` |
| `parameters` | `<class 'backboard.models.ToolParameters'>` | `yes` | `—` |

### `LatestMessageInfo`
- Reduced latest message payload (unique fields only)
- Signature: `LatestMessageInfo(*, metadata_: Optional[Dict[str, Any]] = None, model_provider: Optional[str] = None, model_name: Optional[str] = None, input_tokens: Optional[int] = None, output_tokens: Optional[int] = None, total_tokens: Optional[int] = None, created_at: Optional[datetime.datetime] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `created_at` | `Optional[datetime.datetime]` | `no` | `None` |
| `input_tokens` | `Optional[int]` | `no` | `None` |
| `metadata_` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `model_name` | `Optional[str]` | `no` | `None` |
| `model_provider` | `Optional[str]` | `no` | `None` |
| `output_tokens` | `Optional[int]` | `no` | `None` |
| `total_tokens` | `Optional[int]` | `no` | `None` |

### `MemoriesListResponse`
- Response for listing memories
- Signature: `MemoriesListResponse(*, memories: List[backboard.models.Memory], total_count: int) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `memories` | `List[backboard.models.Memory]` | `yes` | `—` |
| `total_count` | `<class 'int'>` | `yes` | `—` |

### `Memory`
- Memory model
- Signature: `Memory(*, id: str, content: str, metadata: Optional[Dict[str, Any]] = None, score: Optional[float] = None, created_at: Optional[str] = None, updated_at: Optional[str] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `content` | `<class 'str'>` | `yes` | `—` |
| `created_at` | `Optional[str]` | `no` | `None` |
| `id` | `<class 'str'>` | `yes` | `—` |
| `metadata` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `score` | `Optional[float]` | `no` | `None` |
| `updated_at` | `Optional[str]` | `no` | `None` |

### `MemoryCreate`
- Schema for creating a memory
- Signature: `MemoryCreate(*, content: str, metadata: Optional[Dict[str, Any]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `content` | `<class 'str'>` | `yes` | `—` |
| `metadata` | `Optional[Dict[str, Any]]` | `no` | `None` |

### `MemoryStats`
- Memory statistics
- Signature: `MemoryStats(*, total_memories: int = 0, last_updated: Optional[str] = None, limits: Optional[Dict[str, Any]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `last_updated` | `Optional[str]` | `no` | `None` |
| `limits` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `total_memories` | `<class 'int'>` | `no` | `0` |

### `MemoryUpdate`
- Schema for updating a memory
- Signature: `MemoryUpdate(*, content: str, metadata: Optional[Dict[str, Any]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `content` | `<class 'str'>` | `yes` | `—` |
| `metadata` | `Optional[Dict[str, Any]]` | `no` | `None` |

### `Message`
- Message model
- Signature: `Message(*, message_id: uuid.UUID, role: backboard.models.MessageRole, content: Optional[str] = None, created_at: datetime.datetime, status: Optional[str] = None, metadata_: Optional[Dict[str, Any]] = None, attachments: Optional[List[backboard.models.AttachmentInfo]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `attachments` | `Optional[List[backboard.models.AttachmentInfo]]` | `no` | `None` |
| `content` | `Optional[str]` | `no` | `None` |
| `created_at` | `<class 'datetime.datetime'>` | `yes` | `—` |
| `message_id` | `<class 'uuid.UUID'>` | `yes` | `—` |
| `metadata_` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `role` | `<enum 'MessageRole'>` | `yes` | `—` |
| `status` | `Optional[str]` | `no` | `None` |

### `MessageResponse`
- Response from adding a message to a thread
- Signature: `MessageResponse(*, message: str, thread_id: uuid.UUID, content: Optional[str] = None, message_id: Optional[uuid.UUID] = None, role: Optional[backboard.models.MessageRole] = None, status: Optional[str] = None, tool_calls: Optional[List[backboard.models.ToolCall]] = None, run_id: Optional[str] = None, memory_operation_id: Optional[str] = None, retrieved_memories: Optional[List[Dict[str, Any]]] = None, retrieved_files: Optional[List[str]] = None, model_provider: Optional[str] = None, model_name: Optional[str] = None, input_tokens: Optional[int] = None, output_tokens: Optional[int] = None, total_tokens: Optional[int] = None, created_at: Optional[datetime.datetime] = None, attachments: Optional[List[backboard.models.AttachmentInfo]] = None, timestamp: datetime.datetime) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `attachments` | `Optional[List[backboard.models.AttachmentInfo]]` | `no` | `None` |
| `content` | `Optional[str]` | `no` | `None` |
| `created_at` | `Optional[datetime.datetime]` | `no` | `None` |
| `input_tokens` | `Optional[int]` | `no` | `None` |
| `memory_operation_id` | `Optional[str]` | `no` | `None` |
| `message` | `<class 'str'>` | `yes` | `—` |
| `message_id` | `Optional[uuid.UUID]` | `no` | `None` |
| `model_name` | `Optional[str]` | `no` | `None` |
| `model_provider` | `Optional[str]` | `no` | `None` |
| `output_tokens` | `Optional[int]` | `no` | `None` |
| `retrieved_files` | `Optional[List[str]]` | `no` | `None` |
| `retrieved_memories` | `Optional[List[Dict[str, Any]]]` | `no` | `None` |
| `role` | `Optional[backboard.models.MessageRole]` | `no` | `None` |
| `run_id` | `Optional[str]` | `no` | `None` |
| `status` | `Optional[str]` | `no` | `None` |
| `thread_id` | `<class 'uuid.UUID'>` | `yes` | `—` |
| `timestamp` | `<class 'datetime.datetime'>` | `yes` | `—` |
| `tool_calls` | `Optional[List[backboard.models.ToolCall]]` | `no` | `None` |
| `total_tokens` | `Optional[int]` | `no` | `None` |

### `MessageRole`
- Message role types
- Signature: `MessageRole(value, names=None, *, module=None, qualname=None, type=None, start=1)`
- Enum values:
  - `USER` = `user`
  - `ASSISTANT` = `assistant`
  - `SYSTEM` = `system`

### `SubmitToolOutputsRequest`
- Request for submitting tool outputs
- Signature: `SubmitToolOutputsRequest(*, tool_outputs: List[backboard.models.ToolOutput]) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `tool_outputs` | `List[backboard.models.ToolOutput]` | `yes` | `—` |

### `Thread`
- Thread model
- Signature: `Thread(*, thread_id: uuid.UUID, created_at: datetime.datetime, messages: List[backboard.models.Message] = <factory>, metadata_: Optional[Dict[str, Any]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `created_at` | `<class 'datetime.datetime'>` | `yes` | `—` |
| `messages` | `List[backboard.models.Message]` | `no` | `—` |
| `metadata_` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `thread_id` | `<class 'uuid.UUID'>` | `yes` | `—` |

### `ToolCall`
- Tool call from assistant response
- Signature: `ToolCall(*, id: str, type: str, function: backboard.models.ToolCallFunction) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `function` | `<class 'backboard.models.ToolCallFunction'>` | `yes` | `—` |
| `id` | `<class 'str'>` | `yes` | `—` |
| `type` | `<class 'str'>` | `yes` | `—` |

### `ToolCallFunction`
- Tool call function definition
- Signature: `ToolCallFunction(*, name: str, arguments: str) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `arguments` | `<class 'str'>` | `yes` | `—` |
| `name` | `<class 'str'>` | `yes` | `—` |

### `ToolDefinition`
- Tool definition
- Signature: `ToolDefinition(*, type: str = 'function', function: Optional[backboard.models.FunctionDefinition] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `function` | `Optional[backboard.models.FunctionDefinition]` | `no` | `None` |
| `type` | `<class 'str'>` | `no` | `'function'` |

### `ToolOutput`
- Tool output for submitting tool results
- Signature: `ToolOutput(*, tool_call_id: str, output: str) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `output` | `<class 'str'>` | `yes` | `—` |
| `tool_call_id` | `<class 'str'>` | `yes` | `—` |

### `ToolOutputsResponse`
- Response from submitting tool outputs
- Signature: `ToolOutputsResponse(*, message: str, thread_id: uuid.UUID, run_id: str, content: Optional[str] = None, message_id: Optional[uuid.UUID] = None, role: Optional[backboard.models.MessageRole] = None, status: Optional[str] = None, tool_calls: Optional[List[Dict[str, Any]]] = None, memory_operation_id: Optional[str] = None, retrieved_memories: Optional[List[Dict[str, Any]]] = None, retrieved_files: Optional[List[str]] = None, model_provider: Optional[str] = None, model_name: Optional[str] = None, input_tokens: Optional[int] = None, output_tokens: Optional[int] = None, total_tokens: Optional[int] = None, created_at: Optional[datetime.datetime] = None, timestamp: datetime.datetime) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `content` | `Optional[str]` | `no` | `None` |
| `created_at` | `Optional[datetime.datetime]` | `no` | `None` |
| `input_tokens` | `Optional[int]` | `no` | `None` |
| `memory_operation_id` | `Optional[str]` | `no` | `None` |
| `message` | `<class 'str'>` | `yes` | `—` |
| `message_id` | `Optional[uuid.UUID]` | `no` | `None` |
| `model_name` | `Optional[str]` | `no` | `None` |
| `model_provider` | `Optional[str]` | `no` | `None` |
| `output_tokens` | `Optional[int]` | `no` | `None` |
| `retrieved_files` | `Optional[List[str]]` | `no` | `None` |
| `retrieved_memories` | `Optional[List[Dict[str, Any]]]` | `no` | `None` |
| `role` | `Optional[backboard.models.MessageRole]` | `no` | `None` |
| `run_id` | `<class 'str'>` | `yes` | `—` |
| `status` | `Optional[str]` | `no` | `None` |
| `thread_id` | `<class 'uuid.UUID'>` | `yes` | `—` |
| `timestamp` | `<class 'datetime.datetime'>` | `yes` | `—` |
| `tool_calls` | `Optional[List[Dict[str, Any]]]` | `no` | `None` |
| `total_tokens` | `Optional[int]` | `no` | `None` |

### `ToolParameterProperties`
- Tool parameter property definition
- Signature: `ToolParameterProperties(*, type: str, description: Optional[str] = None, enum: Optional[List[str]] = None, properties: Optional[Dict[str, Any]] = None, items: Optional[Dict[str, Any]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `description` | `Optional[str]` | `no` | `None` |
| `enum` | `Optional[List[str]]` | `no` | `None` |
| `items` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `properties` | `Optional[Dict[str, Any]]` | `no` | `None` |
| `type` | `<class 'str'>` | `yes` | `—` |

### `ToolParameters`
- Tool parameters definition
- Signature: `ToolParameters(*, type: str = 'object', properties: Dict[str, backboard.models.ToolParameterProperties] = <factory>, required: Optional[List[str]] = None) -> None`

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `properties` | `Dict[str, backboard.models.ToolParameterProperties]` | `no` | `—` |
| `required` | `Optional[List[str]]` | `no` | `None` |
| `type` | `<class 'str'>` | `no` | `'object'` |

## Exceptions (`backboard.exceptions`)

### `BackboardAPIError`
- Inherits: `BackboardError`
- Signature: `BackboardAPIError(message, status_code=None, response=None)`
- Raised when the API returns an error response

### `BackboardError`
- Inherits: `Exception`
- Signature: `BackboardError(signature unavailable)`
- Base exception for all Backboard API errors

### `BackboardNotFoundError`
- Inherits: `BackboardAPIError`
- Signature: `BackboardNotFoundError(message, status_code=None, response=None)`
- Raised when a resource is not found (404 status code)

### `BackboardRateLimitError`
- Inherits: `BackboardAPIError`
- Signature: `BackboardRateLimitError(message, status_code=None, response=None)`
- Raised when rate limit is exceeded (429 status code)

### `BackboardServerError`
- Inherits: `BackboardAPIError`
- Signature: `BackboardServerError(message, status_code=None, response=None)`
- Raised when server returns 5xx error

### `BackboardValidationError`
- Inherits: `BackboardAPIError`
- Signature: `BackboardValidationError(message, status_code=None, response=None)`
- Raised when request validation fails (400 status code)
