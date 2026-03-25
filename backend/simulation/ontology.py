"""OrcaFish OntologyGenerator — generates entity/relation schema from seed documents"""
import re
from backend.llm.client import LLMClient
from backend.simulation.config import sim_config


ONTOLOGY_PROMPT = """你是一个知识图谱构建专家。从以下文档中提取实体类型和关系类型。

文档内容：
{content}

请分析文档，识别：

1. **实体类型**（人物、组织、地点、事件、概念等），列出每种类型及典型示例。
2. **关系类型**（人物-组织、地点-事件、概念-概念等），列出每种关系及示例。

以JSON格式输出：
{{
  "entity_types": [
    {{
      "type": "实体类型名称",
      "description": "该类实体的定义",
      "examples": ["示例1", "示例2"]
    }}
  ],
  "relation_types": [
    {{
      "type": "关系类型名称",
      "source_types": ["实体A类型"],
      "target_types": ["实体B类型"],
      "description": "该关系的定义",
      "examples": ["示例1", "示例2"]
    }}
  ],
  "summary": "文档的核心实体和关系的总体描述"
}}

只输出JSON："""


class OntologyGenerator:
    """
    Generates knowledge graph ontology (entity/relation types) from documents.
    Ported from MiroFish/backend/app/services/ontology_generator.py
    """

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client

    async def generate(self, content: str) -> dict:
        """
        Generate ontology from document content.

        Returns:
            dict with "entity_types", "relation_types", "summary"
        """
        # Truncate to avoid token limits
        truncated = content[:8000]

        result = await self.llm.invoke_json(
            system_prompt="你是一个专业的知识图谱构建专家，擅长从非结构化文本中提取结构化的实体和关系。",
            user_prompt=ONTOLOGY_PROMPT.format(content=truncated),
        )
        return result

    async def generate_from_seed(
        self,
        seed_content: str,
        simulation_requirement: str = "",
    ) -> dict:
        """
        Generate full ontology from seed material.

        The simulation_requirement provides context about what
        to focus on during entity extraction.
        """
        combined = f"[任务背景]\n{simulation_requirement}\n\n[种子材料]\n{seed_content}"
        return await self.generate(combined)
