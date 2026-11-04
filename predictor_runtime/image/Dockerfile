FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /opt/predictor

RUN python -m pip install --no-deps --index-url https://download.pytorch.org/whl/cpu "torch==2.5.1+cpu"

COPY requirements.txt /opt/predictor/requirements.txt
RUN python -m pip install -r /opt/predictor/requirements.txt \
    && python -m pip install --no-deps "OpenNMT-py==2.3.0"

COPY server.py /opt/predictor/server.py

RUN useradd --create-home --uid 10001 predictor \
    && chown -R predictor:predictor /opt/predictor
USER predictor

EXPOSE 8001
CMD ["python", "/opt/predictor/server.py"]
