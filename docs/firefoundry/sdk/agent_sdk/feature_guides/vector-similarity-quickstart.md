# Vector Similarity Quick Start Guide

## Overview

We've added simple vector similarity support to the FireFoundry SDK, allowing entities to store pre-computed embeddings and perform semantic searches. This guide shows how to use the new functionality.

## Architecture

The vector similarity system consists of:

1. **Database Layer**: `entity.vector_similarity` table stores embeddings linked to entity nodes
2. **Broker Integration**: App runners use the new gRPC broker to generate embeddings
3. **SDK Abstractions**: Simple methods on `EntityNode` and `EntityClient` for storing/searching embeddings
4. **Demo Implementation**: Working example showing how app runners handle embedding generation

## Basic Usage

### 1. App Runner Responsibilities

App runners must handle embedding generation using the new gRPC broker:

```typescript
// In your app runner, get the broker client
import { SimplifiedBrokerClient } from "@firebrandanalytics/ff_broker_client";

// Generate embedding using the new broker
const brokerClient = new SimplifiedBrokerClient(config);
const embeddingResponse = await brokerClient.getEmbedding({
    input: "text to embed",
    modelGroupId: 4, // Use numeric ID (4 for small embeddings)
    scorePreference: {
        intelligenceWeight: 0.5,
        costWeight: 0.5
    }
});

// Store the pre-computed embedding
const embeddingId = await entity.create_embedding(
    embeddingResponse.data[0].embedding, 
    { source: "symptoms", type: "medical" }
);
```

### 2. EntityNode Methods

Entities can store embeddings and find similar entities:

```typescript
// Store a pre-computed embedding for an entity
const embeddingId = await diagnosisEntity.create_embedding(
    embedding, // number[] - pre-computed embedding from broker
    { source: "symptoms", type: "medical" }
);

// Find similar entities
const similarEntities = await diagnosisEntity.find_similar(10, 0.7); // 10 results, 70% threshold
```

### 3. EntityClient Methods

App runners can perform semantic searches:

```typescript
// Search by embedding across all app entities
const searchResults = await this.entity_client.search_by_embedding(
    embedding, // number[] - pre-computed embedding
    5,  // limit
    0.6 // similarity threshold
);

// Create embedding for specific node
const embeddingId = await this.entity_client.create_node_embedding(
    nodeId, 
    embedding, // number[] - pre-computed embedding
    { category: "symptoms" }
);

// Find similar nodes to a specific node
const similar = await this.entity_client.find_similar_nodes(nodeId, 10);
```

## Demo Implementation

### DiagnosisAppRunner Example

```typescript
import { SimplifiedBrokerClient } from "@firebrandanalytics/ff_broker_client";

export class DiagnosisAppRunner extends FFAppRunner<any> {
    private brokerClient: SimplifiedBrokerClient;
    
    override async init() {
        await super.init();
        // Initialize broker client for embeddings
        this.brokerClient = new SimplifiedBrokerClient({
            host: process.env.LLM_BROKER_HOST,
            port: parseInt(process.env.LLM_BROKER_PORT || '50051')
        });
    }
    
    // Generate embedding and search for similar diagnoses
    async semantic_search_diagnoses(symptom_query: string): Promise<any[]> {
        // Generate embedding for the query
        const embeddingResponse = await this.brokerClient.getEmbedding({
            input: symptom_query,
            modelGroupId: 4, // Use numeric ID (4 for small embeddings)
            scorePreference: {
                intelligenceWeight: 0.5,
                costWeight: 0.5
            }
        });
        
        // Search using the embedding
        const searchResults = await this.entity_client.search_by_embedding(
            embeddingResponse.embedding,
            5,   // limit to 5 results
            0.6  // 60% similarity threshold
        );
        
        return searchResults;
    }
}
```

### DiagnosisEntity Example

```typescript
// Store pre-computed embedding for symptoms
async store_embedding_for_symptoms(brokerClient: SimplifiedBrokerClient): Promise<string> {
    const dto = await this.get_dto();
    const symptomsText = dto.data.symptoms;
    
    // App runner generates the embedding
    const embeddingResponse = await brokerClient.getEmbedding({
        input: symptomsText,
        modelGroupId: 4, // Use numeric ID (4 for small embeddings)
        scorePreference: {
            intelligenceWeight: 0.5,
            costWeight: 0.5
        }
    });
    
    // Entity stores the pre-computed embedding
    return await this.create_embedding(
        embeddingResponse.embedding,
        { 
            entity_type: 'diagnosis', 
            symptoms_count: this.parse_symptoms(symptomsText).length 
        }
    );
}

// Find similar diagnosis cases
async find_similar_cases(limit: number = 5): Promise<any[]> {
    const similarResults = await this.find_similar(limit, 0.7);
    
    // Get actual entities with similarity scores
    return await Promise.all(
        similarResults.map(async (result) => {
            const node = await entity_client.get_node(result.node_id);
            return {
                entity: node,
                similarity: result.similarity,
                metadata: result.metadata
            };
        })
    );
}
```

## Testing the Demo - med-iq Implementation

The working demo is implemented in the `med-iq/apps/doc-iq` project.

### 1. Start the doc-iq service

```bash
cd /path/to/med-iq
export LLM_BROKER_HOST=localhost
export LLM_BROKER_PORT=50051
pnpm --filter doc-iq run dev
```

The service will start on port 3001 with vector similarity support.

### 2. Create diagnosis entities

```bash
curl -X POST http://localhost:3001/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "diagnosis-collection-root",
    "method_name": "create_and_run", 
    "args": ["fever, headache, sore throat"]
  }'
```

### 3. Create embeddings for existing diagnoses

```bash
# Get the diagnosis entity ID from the previous step, then:
curl -X POST http://localhost:3001/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "app-runner-id",
    "method_name": "create_embedding_for_diagnosis",
    "args": ["diagnosis-entity-id-here"]
  }'
```

### 4. Perform semantic search

```bash
curl -X POST http://localhost:3001/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "app-runner-id", 
    "method_name": "semantic_search_diagnoses",
    "args": ["chest pain and shortness of breath", 5]
  }'
```

### How it works:

1. **DiagnosisAppRunner** uses the new gRPC broker client to generate embeddings
2. **create_embedding_for_diagnosis** method generates embeddings for diagnosis entities and stores them
3. **semantic_search_diagnoses** generates embeddings for search queries and finds similar stored diagnoses
4. **DiagnosisEntity** provides convenience methods for storing and finding similar cases

The implementation follows the pattern where:
- App runners handle embedding generation via the new gRPC broker
- EntityService/Client store and search pre-computed embeddings  
- No modifications to legacy broker client required

## Database Schema

The `entity.vector_similarity` table structure:

```sql
id          uuid PRIMARY KEY
node_id     uuid REFERENCES entity.node(id)  
embedding   halfvec(3072)  -- OpenAI text-embedding-3-small/large compatible
metadata    jsonb
created     timestamp with time zone
modified    timestamp with time zone  
archive     boolean
```

Includes optimized IVFFlat index for cosine similarity searches.

## Configuration

The system uses these embedding models:
- `default_embedding`: `text-embedding-3-small` (1536 dimensions, cost-effective)
- `large_embedding`: `text-embedding-3-large` (3072 dimensions, higher quality)

Models are automatically selected based on the `model_pool` parameter in requests.

## Future Enhancements

This is a minimal viable implementation. Future improvements could include:

- **Automatic embedding generation** during entity creation
- **Batch embedding operations** for existing entities  
- **Embedding update strategies** when entity data changes
- **Advanced similarity clustering** and recommendations
- **Multi-model embedding support** for different use cases

## Integration with Existing Systems

The vector similarity system integrates cleanly with:
- **Existing entity framework** - no changes to core entity patterns
- **Current broker architecture** - uses established embedding service  
- **PostgreSQL with pgvector** - leverages existing database infrastructure
- **App runner patterns** - familiar method invocation via HTTP API