from __future__ import annotations
"""OrcaFish GraphBuilder - builds Zep knowledge graph from seed documents"""

import uuid
import os
from typing import Optional
from dataclasses import dataclass, field
from backend.simulation.ontology import OntologyGenerator
from backend.simulation.config import sim_config
from backend.graph.graph_builder import GraphBuilder as ZepGraphBuilder


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
        self.zep_builder = ZepGraphBuilder(base_url=os.getenv("ZEP_BASE_URL", ""))

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

        # Step 2: Create local Zep graph and ingest chunks
        graph_id = self.zep_builder.create_graph(project_name)
        self.zep_builder.set_ontology(graph_id, ontology)
        chunk_size = 500
        chunk_overlap = 50
        chunks = []
        for i in range(0, len(seed_content), chunk_size - chunk_overlap):
            chunk = seed_content[i:i + chunk_size]
            if chunk.strip():
                chunks.append(chunk)
        episode_ids = self.zep_builder.add_text_batch(graph_id, chunks)
        self.zep_builder.wait_for_processing(episode_ids)
        graph_info = self.zep_builder.get_graph_info(graph_id)
        entity_count = graph_info.node_count
        relation_count = graph_info.edge_count

        return GraphBuildResult(
            project_id=project_id,
            graph_id=graph_id,
            entity_count=entity_count,
            relation_count=relation_count,
            ontology=ontology,
        )

