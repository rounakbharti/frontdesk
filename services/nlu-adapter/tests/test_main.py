import pytest
from fastapi.testclient import TestClient
from src.main import app, index, kb_documents

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "nlu-adapter"}

def test_nlu_query_mock_mode():
    response = client.post("/nlu/query", json={"query": "Reset my password", "mode": "mock"})
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "mock"
    assert data["confidence"] > 0.85
    assert "account.example.com/reset" in data["answer"]

def test_nlu_query_mock_fallback():
    response = client.post("/nlu/query", json={"query": "Something totally random", "mode": "mock"})
    assert response.status_code == 200
    data = response.json()
    assert data["confidence"] < 0.85

def test_nlu_embeddings():
    response = client.post("/nlu/embeddings", json={"texts": ["Hello world", "Test sentence"]})
    assert response.status_code == 200
    data = response.json()
    assert "embeddings" in data
    assert len(data["embeddings"]) == 2
    assert len(data["embeddings"][0]) == 384  # default all-MiniLM-L6-v2 dimension

def test_faiss_local_model():
    # 1. Populate the FAISS index
    kb = [
        "The company was founded in 1998.",
        "The current server status is nominal and all systems are operational.",
        "To restart your router, unplug it for 30 seconds."
    ]
    res_index = client.post("/nlu/admin/index", json={"documents": kb})
    assert res_index.status_code == 200
    
    # 2. Query the local model
    response = client.post("/nlu/query", json={"query": "How do I fix my router?", "mode": "local_model"})
    assert response.status_code == 200
    data = response.json()
    assert data["confidence"] > 0.0
    assert "unplug it" in data["answer"]
    assert len(data["sources"]) > 0
    assert data["mode"] == "local_model"
