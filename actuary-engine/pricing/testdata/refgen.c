/*
 * refgen.c — Leg A reference driver for the Leg B golden quote set.
 *
 * Reads the resolved kernel inputs (CSV produced by the Go golden test in
 * AK_GOLDEN_DUMP mode), calls ak_premium_compose directly against
 * libactuary_kernels.so — never through Go/cgo — and writes the expected
 * outputs (id,total,pure,loadings). This is the independent Leg A path the
 * Go golden test compares against (Appendix H Leg B).
 *
 * Build:
 *   cc -O2 -o refgen refgen.c \
 *      -I../../kernels/include -L../../kernels/target/release -lactuary_kernels
 * Run:
 *   LD_LIBRARY_PATH=../../kernels/target/release \
 *     ./refgen resolved_inputs.csv golden_expected.csv
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "actuary_kernels.h"

#define MAX_QUOTES 64
#define MAX_VALS 8

static int parse_doubles(char *s, double *out, int maxn) {
    int n = 0;
    if (s == NULL || *s == '\0' || *s == '\n') return 0;
    char *tok = strtok(s, "|");
    while (tok && n < maxn) {
        out[n++] = strtod(tok, NULL);
        tok = strtok(NULL, "|");
    }
    return n;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s resolved_inputs.csv golden_expected.csv\n", argv[0]);
        return 2;
    }
    FILE *in = fopen(argv[1], "r");
    if (!in) { perror("open input"); return 2; }
    FILE *out = fopen(argv[2], "w");
    if (!out) { perror("open output"); return 2; }

    char line[4096];
    if (!fgets(line, sizeof line, in)) { /* header */ }
    fprintf(out, "id,total_kobo,pure_kobo,loadings_kobo\n");

    int count = 0;
    while (fgets(line, sizeof line, in)) {
        /* CSV columns: id, base_pure, rels(|), expense, commission, profit,
         * tax(|), min_kobo, max_kobo — manual split on ',' that preserves
         * empty fields (strtok collapses consecutive delimiters). */
        char *cols[16];
        int ncols = 0;
        char *cursor = line;
        while (ncols < 16) {
            cols[ncols++] = cursor;
            char *comma = strchr(cursor, ',');
            if (!comma) break;
            *comma = '\0';
            cursor = comma + 1;
        }
        /* Strip the trailing newline from the last column. */
        cols[ncols - 1] = strtok(cols[ncols - 1], "\n");
        if (ncols != 9) { fprintf(stderr, "row with %d cols, want 9\n", ncols); return 2; }

        char *id = cols[0];
        double base = strtod(cols[1], NULL);
        double rels[MAX_VALS], taxes[MAX_VALS];
        int nrels = parse_doubles(cols[2], rels, MAX_VALS);
        double expense = strtod(cols[3], NULL);
        double commission = strtod(cols[4], NULL);
        double profit = strtod(cols[5], NULL);
        int ntax = parse_doubles(cols[6], taxes, MAX_VALS);
        int64_t min_kobo = strtoll(cols[7], NULL, 10);
        int64_t max_kobo = strtoll(cols[8], NULL, 10);

        int64_t total = 0, pure = 0, loadings = 0;
        int32_t status = ak_premium_compose(base, rels, (size_t)nrels,
            expense, commission, profit, taxes, (size_t)ntax,
            min_kobo, max_kobo, &total, &pure, &loadings);
        if (status != AK_OK) {
            fprintf(stderr, "quote %s: kernel status %d\n", id, status);
            return 3;
        }
        fprintf(out, "%s,%lld,%lld,%lld\n", id,
            (long long)total, (long long)pure, (long long)loadings);
        count++;
    }
    fclose(in);
    fclose(out);
    printf("refgen: wrote %d expected rows\n", count);
    return 0;
}
