FROM python:3.11-slim-bookworm

WORKDIR /opt/subnetx
COPY requirements.txt /opt/subnetx/requirements.txt
RUN python -m pip install --no-cache-dir -r /opt/subnetx/requirements.txt
COPY engine.py server.py /opt/subnetx/
RUN useradd --create-home --uid 10003 subnetx && chown -R subnetx:subnetx /opt/subnetx

USER subnetx
ENV PYTHONUNBUFFERED=1 \
    SUBNETX_DATABASE=/runtime/subnetx/data/subnetx_extraction.sqlite
EXPOSE 8003
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8003/health', timeout=5)"
CMD ["python", "/opt/subnetx/server.py"]

