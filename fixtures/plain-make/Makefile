CC = cc
CFLAGS = -Wall

.PHONY: build test lint clean

build: main.o
	$(CC) $(CFLAGS) -o app main.o

test: build
	./scripts/run-tests.sh

lint:
	./scripts/lint.sh

clean:
	rm -f app *.o

%.o: %.c
	$(CC) $(CFLAGS) -c $<
