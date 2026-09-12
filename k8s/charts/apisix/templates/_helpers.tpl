{{- define "apisix.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "apisix.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "apisix.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "apisix.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "apisix.labels" -}}
helm.sh/chart: {{ include "apisix.chart" . }}
app.kubernetes.io/name: {{ include "apisix.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: pos-insureportal
{{- end }}

{{- define "apisix.selectorLabels" -}}
app.kubernetes.io/name: {{ include "apisix.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
