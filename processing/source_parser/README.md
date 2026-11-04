# Offline source parsing

`parser.py` is extracted from the original local RDBSB parser. It accepts previously obtained HTML and maps reaction, protein, reference and kinetic fields. It contains no HTTP client, collection queue or retry loop. This inherited-source parsing is not new experimental evidence. The extraction version is retained in config.py.
