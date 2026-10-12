#!/usr/bin/env python3
"""Lê o JSON do osv-scanner e falha só se houver pacote que não é só de dev.

Vitest, postcss e afins não entram no bundle publicado. requirements.txt do
Coletor não marca grupo dev, então qualquer achado lá continua reprovando.
"""

import json
import sys


def main():
    caminho = sys.argv[1]
    dados = json.load(sys.stdin)
    runtime = []
    for resultado in dados.get("results") or []:
        for pacote in resultado.get("packages") or []:
            grupos = pacote.get("dependency_groups") or []
            if grupos and all(grupo == "dev" for grupo in grupos):
                continue
            nome = pacote.get("package", {}).get("name", "?")
            ids = []
            for grupo in pacote.get("groups") or []:
                ids.extend(grupo.get("ids") or [])
            runtime.append(f"{nome} ({', '.join(ids)})")
    if runtime:
        print(f"::error::Vulnerabilidade de runtime em {caminho}")
        for item in runtime:
            print(item)
        return 1
    print(f"osv: {caminho} sem pacote de runtime afetado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
