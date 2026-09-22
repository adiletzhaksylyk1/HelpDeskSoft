.PHONY: lint test version build run docker-up docker-down

lint:
	npm run lint

test:
	npm run test

version:
	node -e "console.log(require('./package.json').version)"

build:
	npm run build

run:
	npm start

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down
