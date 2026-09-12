{{- define "fluvio.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "fluvio.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "fluvio.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "fluvio.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "fluvio.labels" -}}
helm.sh/chart: {{ include "fluvio.chart" . }}
app.kubernetes.io/name: {{ include "fluvio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: pos-insureportal
{{- end }}

{{- define "fluvio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "fluvio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
