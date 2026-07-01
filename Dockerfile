FROM python:3.11-slim

WORKDIR /app

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8787
ENV MARKET_HISTORY_FILE=/tmp/market-history.json

EXPOSE 8787

CMD ["python3", "server.py"]
