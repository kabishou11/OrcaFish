"""Graph building service - Zep Cloud integration"""
import uuid
import time
from typing import Dict, Any, List, Optional, Callable
from zep_cloud.client import Zep
from zep_cloud import EpisodeData, EntityEdgeSourceTarget
from pydantic import Field
from zep_cloud.external_clients.ontology import EntityModel, EntityText, EdgeModel
from loguru import logger
from ..config import settings
from .models import GraphInfo


class GraphBuilder:
    """Build knowledge graphs using Zep Cloud API"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.zep_api_key
        self._client = None

    @property
    def client(self) -> Zep:
        """Lazy initialization of Zep client"""
        if self._client is None:
            if not self.api_key:
                raise ValueError("ZEP_API_KEY not configured - graph building unavailable")
            self._client = Zep(api_key=self.api_key)
        return self._client

    def create_graph(self, name: str) -> str:
        """Create a new graph"""
        graph_id = f"orcafish_{uuid.uuid4().hex[:16]}"
        self.client.graph.create(
            graph_id=graph_id,
            name=name,
            description="OrcaFish Knowledge Graph"
        )
        return graph_id

    def set_ontology(self, graph_id: str, ontology: Dict[str, Any]):
        """Set graph ontology"""
        RESERVED = {'uuid', 'name', 'group_id', 'name_embedding', 'summary', 'created_at'}

        def safe_name(n: str) -> str:
            return f"entity_{n}" if n.lower() in RESERVED else n

        entity_types = {}
        for e in ontology.get("entity_types", []):
            attrs = {"__doc__": e.get("description", ""), "__annotations__": {}}
            for a in e.get("attributes", []):
                attr_name = safe_name(a["name"])
                attrs[attr_name] = Field(description=a.get("description", ""), default=None)
                attrs["__annotations__"][attr_name] = Optional[EntityText]
            entity_types[e["name"]] = type(e["name"], (EntityModel,), attrs)

        edge_definitions = {}
        for edge in ontology.get("edge_types", []):
            attrs = {"__doc__": edge.get("description", ""), "__annotations__": {}}
            for a in edge.get("attributes", []):
                attr_name = safe_name(a["name"])
                attrs[attr_name] = Field(description=a.get("description", ""), default=None)
                attrs["__annotations__"][attr_name] = Optional[str]

            class_name = ''.join(w.capitalize() for w in edge["name"].split('_'))
            edge_class = type(class_name, (EdgeModel,), attrs)

            source_targets = [
                EntityEdgeSourceTarget(source=st.get("source", "Entity"), target=st.get("target", "Entity"))
                for st in edge.get("source_targets", [])
            ]
            if source_targets:
                edge_definitions[edge["name"]] = (edge_class, source_targets)

        if entity_types or edge_definitions:
            self.client.graph.set_ontology(
                graph_ids=[graph_id],
                entities=entity_types or None,
                edges=edge_definitions or None,
            )

    def add_text_batch(self, graph_id: str, text_chunks: List[str]) -> List[str]:
        """Add text chunks to graph"""
        episodes = [EpisodeData(data=chunk, type="text") for chunk in text_chunks]
        result = self.client.graph.add_batch(graph_id=graph_id, episodes=episodes)
        return [getattr(ep, 'uuid_', None) or getattr(ep, 'uuid', '') for ep in result or []]

    def wait_for_processing(self, episode_uuids: List[str], timeout: int = 600):
        """Wait for episodes to be processed"""
        start = time.time()
        pending = set(episode_uuids)
        while pending and time.time() - start < timeout:
            for ep_uuid in list(pending):
                try:
                    ep = self.client.graph.episode.get(uuid_=ep_uuid)
                    if getattr(ep, 'processed', False):
                        pending.remove(ep_uuid)
                except:
                    pass
            if pending:
                time.sleep(3)
        logger.info(f"Processing complete: {len(episode_uuids) - len(pending)}/{len(episode_uuids)}")

    def get_graph_info(self, graph_id: str) -> GraphInfo:
        """Get graph statistics"""
        nodes = list(self.client.graph.node.search(graph_id=graph_id, limit=1000))
        edges = []
        try:
            cursor = None
            while True:
                result = self.client.graph.edge.search(graph_id=graph_id, limit=100, cursor=cursor)
                edges.extend(result.edges if hasattr(result, 'edges') else [])
                if not hasattr(result, 'has_more') or not result.has_more:
                    break
                cursor = getattr(result, 'cursor', None)
        except:
            pass

        entity_types = set()
        for node in nodes:
            for label in node.labels or []:
                if label not in ["Entity", "Node"]:
                    entity_types.add(label)

        return GraphInfo(
            graph_id=graph_id,
            node_count=len(nodes),
            edge_count=len(edges),
            entity_types=list(entity_types)
        )
