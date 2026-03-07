import logging
import os
import time

import faiss
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nlu_adapter")

app = FastAPI(title="NLU Adapter", version="0.1.0")

# -------------------------------------------------------------
# Global AI Model & FAISS Index State
# -------------------------------------------------------------
MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
embedder = None
index = None
kb_documents = []  # In-memory mapping from FAISS index ID -> text/answer

@app.on_event("startup")
def startup_event():
    global embedder, index
    logger.info(f"Loading embedding model: {MODEL_NAME}")
    try:
        embedder = SentenceTransformer(MODEL_NAME)
        # Initialize an empty L2 distance FAISS index based on the model's dimension
        dim = embedder.get_sentence_embedding_dimension()
        index = faiss.IndexFlatL2(dim)
        logger.info(f"Initialized FAISS index with dimension {dim}")
    except Exception as e:
        logger.error(f"Failed to load embedder or FAISS index: {e}")


class QueryRequest(BaseModel):
    query: str
    mode: str = Field(default="mock", description="'mock' or 'local_model'")

class QueryResponse(BaseModel):
    answer: str
    confidence: float
    sources: list[str]
    mode: str
    latency_ms: float

class EmbeddingsRequest(BaseModel):
    texts: list[str]

class EmbeddingsResponse(BaseModel):
    embeddings: list[list[float]]
    latency_ms: float

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "nlu-adapter"}

@app.post("/nlu/query", response_model=QueryResponse)
def nlu_query(req: QueryRequest):
    start_time = time.time()
    
    # Simple Mock NLU logic for Step 3 implementation
    if req.mode == "mock":
        # Simulate different intents based on keywords
        query_lower = req.query.lower()
        if "password" in query_lower or "reset" in query_lower:
            answer = (
                "To reset your password, please visit our self-service portal at "
                "account.example.com/reset. You will need your email and SMS 2FA ready."
            )
            confidence = 0.95
        elif "hours" in query_lower or "open" in query_lower:
            answer = (
                "Our business hours are Monday through Friday, 9:00 AM to 5:00 PM "
                "Eastern Time."
            )
            confidence = 0.92
        else:
            answer = "I am a mock NLU. I did not understand the request."
            confidence = 0.40  # Under the 0.85 threshold to trigger human routing
            
        latency = (time.time() - start_time) * 1000
        logger.info(f"Mock NLU processed query in {latency:.2f}ms. Confidence: {confidence}")
        
        return {
            "answer": answer,
            "confidence": confidence,
            "sources": [],
            "mode": req.mode,
            "latency_ms": latency
        }
    
    # ---------------------------------------------------------
    # EXPERIMENTAL: local_model mode using FAISS & SentenceTransformers
    # ---------------------------------------------------------
    if req.mode == "local_model":
        if not embedder or not index:
            raise HTTPException(status_code=503, detail="Model or index not initialized")
        
        if index.ntotal == 0:
            logger.info("FAISS index is empty; falling back to zero confidence.")
            latency = (time.time() - start_time) * 1000
            return {
                "answer": "I do not have any knowledge base available to answer this question.",
                "confidence": 0.0,
                "sources": [],
                "mode": req.mode,
                "latency_ms": latency
            }
            
        # 1. Embed query
        query_vector = embedder.encode([req.query], convert_to_numpy=True)
        faiss.normalize_L2(query_vector)
        
        # 2. Search FAISS index (Top 1)
        distances, indices_result = index.search(query_vector, 1)
        best_idx = indices_result[0][0]
        best_dist = distances[0][0]
        
        # Cosine similarity approximation from L2 assuming normalized vectors: 
        # L2 = 2 - 2*cos_sim => cos_sim = 1 - (L2 / 2)
        confidence = max(0.0, 1.0 - (best_dist / 2.0))
        
        answer = (
            kb_documents[best_idx]
            if best_idx != -1 and best_idx < len(kb_documents)
            else "Unknown"
        )
        
        latency = (time.time() - start_time) * 1000
        logger.info(f"Local model processed query in {latency:.2f}ms. Confidence: {confidence:.2f}")

        return {
            "answer": answer,
            "confidence": confidence,
            "sources": [f"doc_idx_{best_idx}"],
            "mode": req.mode,
            "latency_ms": latency
        }

    raise HTTPException(status_code=400, detail="Invalid mode")

@app.post("/nlu/embeddings", response_model=EmbeddingsResponse)
def nlu_embeddings(req: EmbeddingsRequest):
    start_time = time.time()
    
    if embedder is None:
        raise HTTPException(status_code=503, detail="Embedding model not initialized")
        
    embeddings_np = embedder.encode(req.texts, convert_to_numpy=True)
    embeddings_list = embeddings_np.tolist()
    
    latency = (time.time() - start_time) * 1000
    
    return {
        "embeddings": embeddings_list,
        "latency_ms": latency
    }

# -------------------------------------------------------------
# Admin / Internal API to populate FAISS index directly for local model demo
# -------------------------------------------------------------
class IndexRequest(BaseModel):
    documents: list[str]

@app.post("/nlu/admin/index")
def populate_index(req: IndexRequest):
    if not embedder or not index:
        raise HTTPException(status_code=503, detail="System not initialized")
        
    global kb_documents
    vectors = embedder.encode(req.documents, convert_to_numpy=True)
    faiss.normalize_L2(vectors)
    
    index.add(vectors)
    kb_documents.extend(req.documents)
    
    return {"status": "success", "added": len(req.documents), "total_index_size": index.ntotal}

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting NLU adapter on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)  # noqa: S104
