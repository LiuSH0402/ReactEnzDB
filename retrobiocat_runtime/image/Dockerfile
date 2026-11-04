FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /opt/retrobiocat

COPY requirements.txt /opt/retrobiocat/requirements.txt
RUN python -m pip install -r /opt/retrobiocat/requirements.txt

COPY adapter.py server.py /opt/retrobiocat/
RUN useradd --create-home --uid 10002 retrobiocat \
    && chown -R retrobiocat:retrobiocat /opt/retrobiocat
USER retrobiocat

EXPOSE 8002
CMD ["python", "/opt/retrobiocat/server.py"]
