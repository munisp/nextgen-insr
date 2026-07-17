{{/*
Expand the name of the chart.
*/}}
{{- define "insureportal-caddy.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "insureportal-caddy.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "insureportal-caddy.labels" -}}
helm.sh/chart: {{ include "insureportal-caddy.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "insureportal-caddy.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: insureportal
com.insureportal.tier: edge
{{- end }}

{{/*
Selector labels
*/}}
{{- define "insureportal-caddy.selectorLabels" -}}
app.kubernetes.io/name: {{ include "insureportal-caddy.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
