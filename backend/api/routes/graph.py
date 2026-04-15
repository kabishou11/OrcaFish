"""Graph API Routes - Ontology generation and graph building"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from backend.graph import OntologyGenerator, GraphBuilder, ZepTools

router = APIRouter(prefix="/graph", tags=["Graph"])

_ontology_gen = OntologyGenerator()
_graph_builder = GraphBuilder()
_graph_tools = ZepTools(_graph_builder)


class OntologyRequest(BaseModel):
    document_texts: List[str]
    simulation_requirement: str
    additional_context: Optional[str] = None


class GraphBuildRequest(BaseModel):
    text: str
    ontology: dict
    graph_name: str = "OrcaFish Graph"
    chunk_size: int = 500


@router.post("/ontology/generate")
async def generate_ontology(req: OntologyRequest):
    """Generate ontology from documents"""
    try:
        result = await _ontology_gen.generate(
            document_texts=req.document_texts,
            simulation_requirement=req.simulation_requirement,
            additional_context=req.additional_context,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/build")
async def build_graph(req: GraphBuildRequest):
    """Build knowledge graph"""
    try:
        graph_id = _graph_builder.create_graph(req.graph_name)
        _graph_builder.set_ontology(graph_id, req.ontology)

        chunks = [req.text[i:i+req.chunk_size] for i in range(0, len(req.text), req.chunk_size)]
        episode_uuids = _graph_builder.add_text_batch(graph_id, chunks[:10])
        _graph_builder.wait_for_processing(episode_uuids)

        info = _graph_builder.get_graph_info(graph_id)
        return {"graph_id": graph_id, "info": info.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{graph_id}")
async def get_graph(graph_id: str):
    """Get graph information"""
    try:
        info = _graph_builder.get_graph_info(graph_id)
        return info.to_dict()
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{graph_id}/search")
async def search_graph(graph_id: str, query: str, limit: int = 8, scope: str = "edges"):
    """Search graph facts/nodes/edges with remote-first fallback."""
    try:
        return _graph_tools.search_graph(graph_id=graph_id, query=query, limit=limit, scope=scope).to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
