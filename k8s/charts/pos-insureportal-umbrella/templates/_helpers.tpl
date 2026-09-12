{{- define "pos-insureportal-umbrella.namespace" -}}
{{- .Values.global.namespace | default .Release.Namespace }}
{{- end }}
