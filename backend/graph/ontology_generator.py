"""Ontology generation service - LLM-driven entity and relationship type design"""
from typing import Dict, Any, List, Optional
from ..llm.client import LLMClient
from ..config import settings


ONTOLOGY_PROMPT = """You are a knowledge graph ontology designer. Analyze the text and design entity types and relationship types suitable for social media opinion simulation.

**Output valid JSON only:**

```json
{
    "entity_types": [
        {
            "name": "EntityTypeName",
            "description": "Brief description (max 100 chars)",
            "attributes": [
                {"name": "attr_name", "type": "text", "description": "Attribute description"}
            ],
            "examples": ["example1", "example2"]
        }
    ],
    "edge_types": [
        {
            "name": "RELATIONSHIP_NAME",
            "description": "Brief description (max 100 chars)",
            "source_targets": [
                {"source": "SourceType", "target": "TargetType"}
            ],
            "attributes": []
        }
    ],
    "analysis_summary": "Brief analysis in Chinese"
}
```

**Rules:**
1. Exactly 10 entity types
2. Last 2 must be: Person (fallback for individuals), Organization (fallback for orgs)
3. First 8 are specific types based on text content
4. 6-10 relationship types
5. Avoid reserved names: uuid, name, group_id, created_at, summary
"""


class OntologyGenerator:
    """Generate ontology definitions using LLM"""

    def __init__(self, llm_client: Optional[LLMClient] = None):
        self.llm_client = llm_client or LLMClient(
            api_key=settings.query_llm.api_key,
            base_url=settings.query_llm.base_url,
            model=settings.query_llm.model,
            provider=settings.query_llm.provider,
        )

    async def generate(
        self,
        document_texts: List[str],
        simulation_requirement: str,
        additional_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate ontology definition"""
        combined_text = "\n\n---\n\n".join(document_texts)
        if len(combined_text) > 50000:
            combined_text = combined_text[:50000] + f"\n\n...(truncated from {len(combined_text)} chars)..."

        user_message = f"""## Simulation Requirement
{simulation_requirement}

## Document Content
{combined_text}"""

        if additional_context:
            user_message += f"\n\n## Additional Context\n{additional_context}"

        user_message += "\n\nDesign entity types and relationship types following the rules above."

        result = await self.llm_client.invoke_json(
            system_prompt=ONTOLOGY_PROMPT,
            user_prompt=user_message,
            temperature=0.3,
        )

        return self._validate(result)

    def _validate(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and ensure fallback types"""
        result.setdefault("entity_types", [])
        result.setdefault("edge_types", [])
        result.setdefault("analysis_summary", "")

        entity_names = {e["name"] for e in result["entity_types"]}
        fallbacks = []
        if "Person" not in entity_names:
            fallbacks.append({
                "name": "Person",
                "description": "Any individual person not fitting other specific types.",
                "attributes": [
                    {"name": "full_name", "type": "text", "description": "Full name"},
                    {"name": "role", "type": "text", "description": "Role or occupation"}
                ],
                "examples": ["ordinary citizen"]
            })
        if "Organization" not in entity_names:
            fallbacks.append({
                "name": "Organization",
                "description": "Any organization not fitting other specific types.",
                "attributes": [
                    {"name": "org_name", "type": "text", "description": "Organization name"},
                    {"name": "org_type", "type": "text", "description": "Type of organization"}
                ],
                "examples": ["community group"]
            })

        if fallbacks:
            if len(result["entity_types"]) + len(fallbacks) > 10:
                result["entity_types"] = result["entity_types"][:10 - len(fallbacks)]
            result["entity_types"].extend(fallbacks)

        result["entity_types"] = result["entity_types"][:10]
        result["edge_types"] = result["edge_types"][:10]

        return result
