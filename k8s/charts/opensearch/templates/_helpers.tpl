{{- define "opensearch.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opensearch.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "opensearch.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "opensearch.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opensearch.labels" -}}
helm.sh/chart: {{ include "opensearch.chart" . }}
app.kubernetes.io/name: {{ include "opensearch.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: pos-insureportal
{{- end }}

{{- define "opensearch.selectorLabels" -}}
app.kubernetes.io/name: {{ include "opensearch.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
