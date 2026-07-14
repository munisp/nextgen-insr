{{/*
Expand the name of the chart.
*/}}
{{- define "ngapp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ngapp.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "ngapp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ngapp.labels" -}}
helm.sh/chart: {{ include "ngapp.chart" . }}
{{ include "ngapp.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ngapp-platform
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ngapp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ngapp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service labels for a specific microservice
*/}}
{{- define "ngapp.serviceLabels" -}}
helm.sh/chart: {{ include "ngapp.chart" .root }}
app.kubernetes.io/name: {{ .serviceName }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: ngapp-platform
app.kubernetes.io/component: {{ .component | default "backend" }}
{{- end }}

{{/*
Service selector labels for a specific microservice
*/}}
{{- define "ngapp.serviceSelectorLabels" -}}
app.kubernetes.io/name: {{ .serviceName }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/*
Create image name
*/}}
{{- define "ngapp.serviceImage" -}}
{{- $registry := .root.Values.global.imageRegistry | default "" -}}
{{- $repo := printf "ngapp/%s" .serviceName -}}
{{- $tag := .root.Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

{{/*
Namespace
*/}}
{{- define "ngapp.namespace" -}}
{{- default .Release.Namespace .Values.namespace | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create the namespace-scoped service name
*/}}
{{- define "ngapp.serviceName" -}}
{{- printf "%s-%s" (include "ngapp.fullname" .) .name -}}
{{- end }}

{{/*
Get environment name
*/}}
{{- define "ngapp.environment" -}}
{{- .Values.global.environment | default "production" -}}
{{- end }}

{{/*
Service port name (kebab-case of service name)
*/}}
{{- define "ngapp.servicePortName" -}}
{{- .port | default 8080 -}}
{{- end }}
