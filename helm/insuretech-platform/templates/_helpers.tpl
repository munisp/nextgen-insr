{{/*
Expand the name of the chart.
*/}}
{{- define "insuretech.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "insuretech.fullname" -}}
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
{{- define "insuretech.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "insuretech.labels" -}}
helm.sh/chart: {{ include "insuretech.chart" . }}
{{ include "insuretech.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: insuretech-platform
{{- end }}

{{/*
Selector labels
*/}}
{{- define "insuretech.selectorLabels" -}}
app.kubernetes.io/name: {{ include "insuretech.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service labels for a specific microservice
*/}}
{{- define "insuretech.serviceLabels" -}}
helm.sh/chart: {{ include "insuretech.chart" .root }}
app.kubernetes.io/name: {{ .serviceName }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: insuretech-platform
app.kubernetes.io/component: {{ .component | default "backend" }}
{{- end }}

{{/*
Service selector labels for a specific microservice
*/}}
{{- define "insuretech.serviceSelectorLabels" -}}
app.kubernetes.io/name: {{ .serviceName }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/*
Create image name
*/}}
{{- define "insuretech.serviceImage" -}}
{{- $registry := .root.Values.global.imageRegistry | default "" -}}
{{- $repo := printf "insuretech/%s" .serviceName -}}
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
{{- define "insuretech.namespace" -}}
{{- default .Release.Namespace .Values.namespace | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create the namespace-scoped service name
*/}}
{{- define "insuretech.serviceName" -}}
{{- printf "%s-%s" (include "insuretech.fullname" .) .name -}}
{{- end }}

{{/*
Get environment name
*/}}
{{- define "insuretech.environment" -}}
{{- .Values.global.environment | default "production" -}}
{{- end }}

{{/*
Service port name (kebab-case of service name)
*/}}
{{- define "insuretech.servicePortName" -}}
{{- .port | default 8080 -}}
{{- end }}
