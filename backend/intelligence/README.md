# OrcaFish Intelligence API - Quick Start

## API Endpoints

### CII Scores
```bash
# Get all country CII scores
GET /api/intelligence/cii

# Get specific country
GET /api/intelligence/cii/UA
```

### Signals
```bash
# Get all signals
GET /api/intelligence/signals

# Get convergence zones
GET /api/intelligence/signals/convergence
```

### Data Ingestion
```bash
# Ingest external data
POST /api/intelligence/ingest
{
  "type": "protests",
  "data": [...]
}
```

## Python Usage

```python
from backend.intelligence.cii import CIICalculator, CIICache
from backend.intelligence.signals import SignalAggregator
from backend.intelligence.sources import ACLEDClient, UCDPClient

# Calculate CII
calculator = CIICalculator()
calculator.ingest_data("UA", {"protests": 10, "conflicts": 5})
score = calculator.calculate_score("UA")

# Aggregate signals
aggregator = SignalAggregator()
clusters = aggregator.get_country_clusters()
zones = aggregator.get_convergence_zones()

# Fetch external data
acled = ACLEDClient(api_key="...", email="...")
events = await acled.fetch_events(country="Ukraine")
```

## Data Sources

- **ACLED**: Conflict/protest events (requires API key)
- **UCDP**: Uppsala conflict data (public)
- **HAPI**: Humanitarian data (public)

## Configuration

Set environment variables:
```bash
ACLED_API_KEY=your_key
ACLED_EMAIL=your_email
```
