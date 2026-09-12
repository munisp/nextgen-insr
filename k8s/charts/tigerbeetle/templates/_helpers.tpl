{{- define "tigerbeetle.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "tigerbeetle.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "tigerbeetle.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "tigerbeetle.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "tigerbeetle.labels" -}}
helm.sh/chart: {{ include "tigerbeetle.chart" . }}
app.kubernetes.io/name: {{ include "tigerbeetle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: pos-insureportal
{{- end }}

{{- define "tigerbeetle.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tigerbeetle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
