# PitBox spike

Throwaway checks to confirm the free F1 data sources work before we design the data layer.

```
cd Desktop\pitbox\spike
python check_sources.py            # Jolpica + static archive (no installs needed)
pip install fastf1                 # optional, for check 3
python check_sources.py
```

Not tested here: the live SignalR feed. That needs a live session (next race weekend).
