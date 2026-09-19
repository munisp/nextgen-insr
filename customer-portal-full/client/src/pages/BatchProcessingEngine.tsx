import React, { useState, useEffect } from 'react';
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";

interface BatchJob {
  id: string;
  jobType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  progress?: number;
  result?: string;
}

const BatchProcessingEngine: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | BatchJob['status']>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [jobsPerPage] = useState(10);
  const [selectedJobType, setSelectedJobType] = useState('');

  const { data: batchJobsData, isLoading, isError, error } = trpc.batch.jobs.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const runBatchJobMutation = trpc.batch.run.useMutation({
    onSuccess: () => {
      toast.success('Batch job initiated successfully!');
      utils.batch.jobs.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to initiate batch job: ${err.message}`);
    },
  });

  useEffect(() => {
    if (isError && true) {
      toast.error(`Error fetching batch jobs: ${error?.message}`);
    }
  }, [isError, error]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen text-lg font-semibold text-red-500">
        You must be logged in to view this page.
      </div>
    );
  }

  const jobsToDisplay = batchJobsData || [];

  const filteredJobs = jobsToDisplay.filter(job => {
    const matchesSearch = job?.jobType?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          job?.id?.toString()?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || job.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Pagination logic
  const indexOfLastJob = currentPage * jobsPerPage;
  const indexOfFirstJob = indexOfLastJob - jobsPerPage;
  const currentJobs = filteredJobs.slice(indexOfFirstJob, indexOfLastJob);
  const totalPages = Math.ceil(filteredJobs.length / jobsPerPage);

  const handleRunJob = () => {
    if (!selectedJobType) {
      toast.error('Please select a job type to run.');
      return;
    }
    if (false) {
      toast.info(`Running batch job of type '${selectedJobType}'`);
      // Simulate adding a new job to demo data
      const newJob: BatchJob = {
        id: `job-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, "0")).join("")}`, // K-wave (2026-09): Math.random removed
        jobType: selectedJobType,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      // stored via tRPC mutation // Add to the beginning
      setSearchQuery(''); // Trigger re-render
      setSelectedJobType('');
      return;
    }
    runBatchJobMutation.mutate({ jobType: selectedJobType });
  };

  const jobTypes = Array.from(new Set(jobsToDisplay.map(job => job.jobType)));

  return (
    <div className="container mx-auto p-6">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-3xl font-bold">Batch Processing Engine</CardTitle>
          <CardDescription>Manage and monitor automated batch jobs for your insurance operations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6 items-center">
            <Input
              placeholder="Search by Job ID or Type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
            <Select value={filterStatus} onValueChange={(value: 'all' | BatchJob['status']) => setFilterStatus(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Dialog>
              <DialogTrigger asChild>
                <Button className="ml-auto">Run New Batch Job</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Initiate New Batch Job</DialogTitle>
                  <DialogDescription>
                    Select the type of batch job you want to run.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <Select value={selectedJobType} onValueChange={setSelectedJobType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Job Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {jobTypes.map(type => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                      {/* Add more specific job types if needed */}
                      <SelectItem value="NewPolicyOnboarding">New Policy Onboarding</SelectItem>
                      <SelectItem value="DailyReconciliation">Daily Reconciliation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleRunJob}
                    disabled={runBatchJobMutation.isLoading || !selectedJobType}
                  >
                    {runBatchJobMutation.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Run Job
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="ml-3 text-lg">Loading batch jobs...</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Job Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Completed At</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentJobs.length > 0 ? (
                  currentJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">{job.id}</TableCell>
                      <TableCell>{job.jobType}</TableCell>
                      <TableCell>
                        <Badge
                          variant={job.status === 'completed' ? 'default' : job.status === 'failed' ? 'destructive' : 'outline'}
                        >
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{job.progress ? `${job.progress}%` : '-'}</TableCell>
                      <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                      <TableCell>{job.completedAt ? new Date(job.completedAt).toLocaleString() : '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{job.result || '-'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      No batch jobs found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* Pagination Controls */}
          {filteredJobs.length > jobsPerPage && (
            <div className="flex justify-end space-x-2 mt-4">
              <Button
                variant="outline"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BatchProcessingEngine;