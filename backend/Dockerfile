# Build stage: pins the go.mod toolchain (go 1.26.0).
FROM golang:1.26.0-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/playtrail ./cmd/playtrail

# One image serves serve | worker | migrate | seed | admin-create |
# rebuild-public | crawl (ARCHITECTURE §1).
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
	&& addgroup -S app && adduser -S app -G app
COPY --from=build /out/playtrail /usr/local/bin/playtrail
USER app
ENTRYPOINT ["playtrail"]
