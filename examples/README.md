# Examples

- `single_step/query.json`: a PAL reaction query from L-phenylalanine to trans-cinnamate.
- `multistep/recorded_route_20261031.json`: a recorded two-step candidate route, retaining its historical verification status.

The website's candidate-specific literature notes are stored in `nextjs_site/Nicktio-nextjs-pro-main/package/public/data/reaction-enzyme-literature.json`. They are separate from the frozen source assertions. CAR and CHR notes refer to specific candidates, constructs and experimental readouts; they do not establish experimental validation of the complete cascade.

## Structure-matching example

Use a compatible lookup index and the corresponding RDKit environment:

```bash
python nextjs_site/Nicktio-nextjs-pro-main/package/scripts/retrosynthesis_mapping.py --index /path/to/lookup.sqlite --query '{"precursors":"N[C@@H](Cc1ccccc1)C(=O)O","product":"O=C(O)/C=C/c1ccccc1"}'
```

Small synthetic databases used in tests are fixtures, separate from the scientific examples and evaluation inputs.
