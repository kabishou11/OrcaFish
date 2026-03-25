# MiroFish Agent Simulation System - Migrated to OrcaFish

## Structure

```
backend/simulation/
├── manager.py              # Simulation lifecycle management
├── profile_generator.py    # OASIS agent profile generation
├── config_generator.py     # Simulation configuration generation
├── runner.py              # Simulation execution runner
├── logger.py              # Action logging
└── platforms/
    ├── twitter.py         # Twitter simulation script
    └── reddit.py          # Reddit simulation script
```

## API Endpoints

### Core Endpoints
- `POST /api/simulation/runs` - Create simulation
- `POST /api/simulation/runs/{id}/start` - Start simulation
- `GET /api/simulation/runs/{id}/status` - Get status
- `GET /api/simulation/runs/{id}/detail` - Get detailed actions

## Migration Status

✅ Core structure created
✅ Manager, profile generator, config generator
✅ Runner and platform scripts
✅ Action logger
✅ API endpoints integrated

## Next Steps

1. Integrate with Zep graph for entity extraction
2. Add LLM-based profile generation
3. Implement full OASIS integration
4. Add IPC for runtime control
