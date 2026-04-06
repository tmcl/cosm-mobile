#!/usr/bin/env bash
for i in *.sql; do jq -sR . $i > $i.json; done
