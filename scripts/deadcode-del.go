// deadcode-del: delete unused top-level decls reported by golangci-lint's
// 'unused' linter (JSON on stdin), iterating to fixpoint. Run inside a module.
// Only deletes unexported func/method/type/var/const decls the linter flags;
// go/printer preserves the rest. Usage: go run deadcode-del.go < findings.json
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type issue struct {
	Pos struct {
		Filename string `json:"Filename"`
		Line     int    `json:"Line"`
	} `json:"Pos"`
	Text       string `json:"Text"`
	FromLinter string `json:"FromLinter"`
}

var nameRe = regexp.MustCompile("`(?:\\(\\*?\\w+\\)\\.)?(\\w+)`")

func main() {
	var issues struct {
		Issues []issue `json:"Issues"`
	}
	if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&issues); err != nil {
		fmt.Fprintln(os.Stderr, "expected golangci-lint --out-format json on stdin:", err)
		os.Exit(1)
	}
	byFile := map[string]map[string]bool{}
	add := func(f, n string) {
		if byFile[f] == nil {
			byFile[f] = map[string]bool{}
		}
		byFile[f][n] = true
	}
	for _, is := range issues.Issues {
		if is.FromLinter != "unused" {
			continue
		}
		m := nameRe.FindStringSubmatch(is.Text)
		if m != nil {
			add(is.Pos.Filename, m[1])
		}
	}
	removed := 0
	err := filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		rel := strings.TrimPrefix(path, "./")
		names := byFile[rel]
		if names == nil {
			byFile2 := byFile[path]
			if byFile2 == nil {
				return nil
			}
			names = byFile2
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if err != nil {
			return nil
		}
		changed := false
		var decls []ast.Decl
		for _, d := range f.Decls {
			switch dd := d.(type) {
			case *ast.FuncDecl:
				if names[dd.Name.Name] && !dd.Name.IsExported() {
					changed = true
					removed++
					continue
				}
			case *ast.GenDecl:
				var specs []ast.Spec
				for _, s := range dd.Specs {
					switch ss := s.(type) {
					case *ast.ValueSpec:
						// keep spec if ANY name is used/exported
						keep := false
						for _, n := range ss.Names {
							if !names[n.Name] || n.IsExported() {
								keep = true
							}
						}
						if keep {
							specs = append(specs, s)
						} else {
							changed = true
							removed++
						}
					case *ast.TypeSpec:
						if names[ss.Name.Name] && !ss.Name.IsExported() {
							changed = true
							removed++
						} else {
							specs = append(specs, s)
						}
					default:
						specs = append(specs, s)
					}
				}
				if len(specs) == 0 && dd.Tok != token.IMPORT {
					continue
				}
				dd.Specs = specs
			}
			decls = append(decls, d)
		}
		if !changed {
			return nil
		}
		f.Decls = decls
		var b strings.Builder
		if err := printer.Fprint(&b, fset, f); err != nil {
			return nil
		}
		return os.WriteFile(path, []byte(b.String()), 0644)
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("deadcode-del: removed %d decls\n", removed)
}
