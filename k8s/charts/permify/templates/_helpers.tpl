{{- define "permify.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "permify.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "permify.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "permify.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "permify.labels" -}}
helm.sh/chart: {{ include "permify.chart" . }}
app.kubernetes.io/name: {{ include "permify.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: pos-insureportal
{{- end }}

{{- define "permify.selectorLabels" -}}
app.kubernetes.io/name: {{ include "permify.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
