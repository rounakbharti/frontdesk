"""
NLU Adapter — FastAPI entry point stub
Step 0: skeleton only. Full implementation in Step 3 (feature/step-03-nlu).
"""
from fastapi import FastAPI

app = FastAPI(
    title="Frontdesk NLU Adapter",
    description="NLU service with mock + optional sentence-transformers",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "step": "skeleton — Step 3 will implement full NLU"}
