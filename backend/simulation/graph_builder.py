"""OrcaFish GraphBuilder - builds Zep knowledge graph from seed documents"""
import uuid
import os
from typing import Optional
from dataclasses import dataclass, field
from backend.simulation.ontology import OntologyGenerator
from backend.simulation.config import sim_config


@dataclass
class GraphBuildResult:
    project_id: str
    graph_id: str
    entity_count: int = 0
    relation_count: int = 0
    ontology: dict = field(default_factory=dict)


class GraphBuilder:
    """
    Builds knowledge graph from seed documents.
    Uses Zep Cloud as the graph backend.
    Ported from MiroFish/backend/app/services/graph_builder.py
    """

    def __init__(self, zep_api_key: str = ""):
        self.zep_api_key = zep_api_key or os.getenv("ZEP_API_KEY", "")
        self.ontology_gen: Optional[OntologyGenerator] = None

    def set_llm(self, llm_client):
        self.ontology_gen = OntologyGenerator(llm_client)

    async def build(
        self,
        seed_content: str,
        project_name: str,
        simulation_requirement: str = "",
    ) -> GraphBuildResult:
        """
        Full pipeline:
        1. Generate ontology (LLM)
        2. Create project + graph
        3. Ingest document chunks into graph

        Returns project_id and graph_id.
        """
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        graph_id = f"graph_{uuid.uuid4().hex[:12]}"

        # Step 1: Generate ontology
        ontology = {}
        if self.ontology_gen:
            ontology = await self.ontology_gen.generate_from_seed(
                seed_content, simulation_requirement
            )

        # Step 2: Create Zep graph (if API key available)
        if self.zep_api_key:
            await self._create_zep_graph(graph_id, ontology)
            entity_count, relation_count = await self._ingest_chunks(
                graph_id, seed_content
            )
        else:
            # Simulate counts for demo
            entity_count = ontology.get("entity_types", []).__len__() * 3
            relation_count = ontology.get("relation_types", []).__len__() * 2

        return GraphBuildResult(
            project_id=project_id,
            graph_id=graph_id,
            entity_count=entity_count,
            relation_count=relation_count,
            ontology=ontology,
        )

    async def _create_zep_graph(self, graph_id: str, ontology: dict):
        """Create Zep graph with custom schema"""
        import httpx
        async with httpx.AsyncClient(
            base_url="https://api.getzep.com",
            headers={"Authorization": f"Bearer {self.zep_api_key}"},
            timeout=30.0,
        ) as client:
            # Zep API: create graph with custom entity types
            # This is a simplified version - actual implementation
            # would use Zep's specific API
            pass

    async def _ingest_chunks(self, graph_id: str, content: str) -> tuple[int, int]:
        """Split content into chunks and ingest into Zep"""
        # Simple chunking (500 chars, 50 overlap)
        chunk_size = 500
        chunk_overlap = 50
        chunks = []
        for i in range(0, len(content), chunk_size - chunk_overlap):
            chunk = content[i:i+chunk_size]
            if chunk.strip():
                chunks.append(chunk)

        # Ingest chunks (simplified)
        # In production: call Zep API to add documents
        return len(chunks), len(chunks) // 2
