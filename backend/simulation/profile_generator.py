"""Profile Generator - Generate OASIS agent profiles from entities"""
from typing import List, Dict, Any
from dataclasses import dataclass


@dataclass
class OasisAgentProfile:
    user_id: int
    user_name: str
    name: str
    bio: str
    persona: str

    def to_reddit_format(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.user_name,
            "name": self.name,
            "bio": self.bio,
            "persona": self.persona,
            "karma": 1000
        }

    def to_twitter_format(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "user_name": self.user_name,
            "name": self.name,
            "bio": self.bio,
            "persona": self.persona,
            "follower_count": 150,
            "friend_count": 100
        }


class OasisProfileGenerator:
    """Generate OASIS agent profiles"""

    def generate_profiles(self, entities: List[Dict], use_llm: bool = False) -> List[OasisAgentProfile]:
        profiles = []
        for i, entity in enumerate(entities):
            profile = OasisAgentProfile(
                user_id=i,
                user_name=entity.get("name", f"user_{i}"),
                name=entity.get("name", f"Agent {i}"),
                bio=entity.get("summary", "")[:200],
                persona=entity.get("summary", "")[:500]
            )
            profiles.append(profile)
        return profiles

    def save_profiles(self, profiles: List[OasisAgentProfile], file_path: str, platform: str = "reddit"):
        import json
        if platform == "reddit":
            data = [p.to_reddit_format() for p in profiles]
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        elif platform == "twitter":
            import csv
            with open(file_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=["user_id", "user_name", "name", "bio", "persona", "follower_count", "friend_count"])
                writer.writeheader()
                for p in profiles:
                    writer.writerow(p.to_twitter_format())
