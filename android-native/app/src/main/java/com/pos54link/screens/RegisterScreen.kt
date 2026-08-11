package com.nigerianremittance.cdp.registration

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.regex.Pattern

// --- 1. Data Layer: API Service Interface ---

/**
 * Represents the successful response after final registration/verification.
 * In a real app, this would contain user tokens, profile data, etc.
 * @property userId The unique identifier for the newly registered user.
 */
data class RegistrationSuccess(val userId: String)

/**
 * Interface for the Customer Data Platform (CDP) API calls.
 * This is where the actual network calls would be implemented (e.g., using Retrofit).
 */
interface CdpApiService {
    /**
     * Initiates the registration process by sending an OTP to the provided email.
     * @param email The user's email address.
     * @return A [Result] indicating success or failure.
     */
    suspend fun register(email: String): Result<Unit>

    /**
     * Verifies the OTP and completes the registration.
     * @param email The user's email address.
     * @param otp The one-time password received by the user.
     * @return A [Result] containing [RegistrationSuccess] on success.
     */
    suspend fun verifyOtp(email: String, otp: String): Result<RegistrationSuccess>
}

// NOTE: The previous MockCdpApiService default (which accepted the hardcoded OTP
// "123456" and faked network delays) has been removed. Registration must always
// run against the real CDP backend.

// --- 2. Domain/Presentation Layer: State and ViewModel ---

/**
 * Defines the steps in the registration flow.
 */
sealed class RegistrationStep {
    data object EmailInput : RegistrationStep()
    data object OtpInput : RegistrationStep()
    data class Success(val result: RegistrationSuccess) : RegistrationStep()
}

/**
 * Represents the entire UI state for the registration screen.
 * @property email The current value of the email input field.
 * @property otp The current value of the OTP input field.
 * @property isLoading Whether an API call is currently in progress.
 * @property error A user-facing error message, or null if no error.
 * @property currentStep The current stage of the registration process.
 */
data class RegisterUiState(
    val email: String = "",
    val otp: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val currentStep: RegistrationStep = RegistrationStep.EmailInput
) {
    /**
     * Checks if the email input is valid.
     * Uses a simple regex for demonstration. In a real app, use Android's Patterns.EMAIL_ADDRESS.
     */
    val isEmailValid: Boolean
        get() = Pattern.compile(
            "^\\S+@\\S+\\.\\S+$"
        ).matcher(email).matches()

    /**
     * Checks if the OTP input is valid (6 digits).
     */
    val isOtpValid: Boolean
        get() = otp.length == 6 && otp.all { it.isDigit() }
}

/**
 * ViewModel to handle the business logic and state management for the registration flow.
 * @property apiService The dependency for making CDP API calls.
 *
 * TODO(DI): Wire the real [CdpApiService] implementation (e.g. Retrofit-backed)
 * via the app's dependency-injection graph / ViewModel factory. There is
 * intentionally NO mock default — registration must never run against a fake
 * service in production.
 */
class RegisterViewModel(
    private val apiService: CdpApiService
) : ViewModel() {

    private val _uiState = MutableStateFlow(RegisterUiState())
    val uiState: StateFlow<RegisterUiState> = _uiState

    /**
     * Updates the email field in the UI state.
     */
    fun onEmailChange(newEmail: String) {
        _uiState.update { it.copy(email = newEmail, error = null) }
    }

    /**
     * Updates the OTP field in the UI state.
     */
    fun onOtpChange(newOtp: String) {
        // Limit OTP input to 6 characters
        if (newOtp.length <= 6) {
            _uiState.update { it.copy(otp = newOtp, error = null) }
        }
    }

    /**
     * Handles the initial registration click (sending OTP).
     */
    fun onRegisterClick() {
        val state = _uiState.value
        if (!state.isEmailValid) {
            _uiState.update { it.copy(error = "Please enter a valid email address.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val result = apiService.register(state.email)
                result.onSuccess {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            currentStep = RegistrationStep.OtpInput
                        )
                    }
                }.onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = exception.message ?: "Failed to send OTP. Please try again."
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Network error. Check your connection."
                    )
                }
            }
        }
    }

    /**
     * Handles the OTP verification click (completing registration).
     */
    fun onVerifyOtpClick() {
        val state = _uiState.value
        if (!state.isOtpValid) {
            _uiState.update { it.copy(error = "Please enter the 6-digit OTP.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val result = apiService.verifyOtp(state.email, state.otp)
                result.onSuccess { successData ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            currentStep = RegistrationStep.Success(successData)
                        )
                    }
                }.onFailure { exception ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = exception.message ?: "OTP verification failed."
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Network error during verification."
                    )
                }
            }
        }
    }
}

// --- 3. Presentation Layer: Composable UI ---

/**
 * The main Composable function for the Registration Screen.
 * It handles the different steps of the registration flow.
 * @param viewModel The [RegisterViewModel] instance.
 * @param onRegistrationComplete Callback function when registration is successful.
 */
@Composable
fun RegisterScreen(
    // TODO(DI): Supply via a ViewModel factory that injects the real CdpApiService,
    // e.g. viewModel(factory = RegisterViewModelFactory(cdpApiService)).
    viewModel: RegisterViewModel,
    onRegistrationComplete: (RegistrationSuccess) -> Unit = {}
) {
    // Collect the UI state as a Compose State
    val state by viewModel.uiState.collectAsState()

    // Handle navigation on successful registration
    LaunchedEffect(state.currentStep) {
        if (state.currentStep is RegistrationStep.Success) {
            onRegistrationComplete((state.currentStep as RegistrationStep.Success).result)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("CDP Registration") })
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Display the appropriate screen based on the current step
            when (state.currentStep) {
                RegistrationStep.EmailInput -> EmailInputStep(state, viewModel)
                RegistrationStep.OtpInput -> OtpInputStep(state, viewModel)
                is RegistrationStep.Success -> SuccessMessage(state.currentStep.result)
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Display error message if present
            state.error?.let { errorMessage ->
                Text(
                    text = errorMessage,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(8.dp)
                )
            }

            // Display loading indicator
            if (state.isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Text("Processing...", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * Composable for the initial email input step.
 */
@Composable
private fun EmailInputStep(
    state: RegisterUiState,
    viewModel: RegisterViewModel
) {
    Text(
        text = "Step 1: Enter your email to register",
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.padding(bottom = 16.dp)
    )

    OutlinedTextField(
        value = state.email,
        onValueChange = viewModel::onEmailChange,
        label = { Text("Email Address") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        isError = state.error != null && !state.isEmailValid,
        supportingText = {
            if (state.error != null && !state.isEmailValid) {
                Text("Invalid email format")
            }
        },
        modifier = Modifier.fillMaxWidth()
    )

    Spacer(modifier = Modifier.height(16.dp))

    Button(
        onClick = viewModel::onRegisterClick,
        enabled = state.isEmailValid && !state.isLoading,
        modifier = Modifier.fillMaxWidth()
    ) {
        Text("Send OTP")
    }
}

/**
 * Composable for the OTP input and verification step.
 */
@Composable
private fun OtpInputStep(
    state: RegisterUiState,
    viewModel: RegisterViewModel
) {
    Text(
        text = "Step 2: Enter the 6-digit OTP sent to ${state.email}",
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.padding(bottom = 16.dp)
    )

    OutlinedTextField(
        value = state.otp,
        onValueChange = viewModel::onOtpChange,
        label = { Text("One-Time Password (OTP)") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        isError = state.error != null && !state.isOtpValid,
        supportingText = {
            if (state.error != null && !state.isOtpValid) {
                Text("OTP must be 6 digits")
            }
        },
        modifier = Modifier.fillMaxWidth()
    )

    Spacer(modifier = Modifier.height(16.dp))

    Button(
        onClick = viewModel::onVerifyOtpClick,
        enabled = state.isOtpValid && !state.isLoading,
        modifier = Modifier.fillMaxWidth()
    ) {
        Text("Verify and Complete Registration")
    }
}

/**
 * Composable to display a success message.
 */
@Composable
private fun SuccessMessage(result: RegistrationSuccess) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = "Registration Successful!",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Welcome to the Nigerian Remittance Platform.",
            style = MaterialTheme.typography.bodyLarge
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "User ID: ${result.userId}",
            style = MaterialTheme.typography.bodySmall
        )
    }
}

// --- 4. Previews for Development ---

/**
 * Preview-only stub. Used exclusively by @Preview composables; never referenced
 * by app code paths. It performs no network I/O and accepts no OTP — it only
 * returns canned results so the UI can be rendered in the design tool.
 */
private class PreviewCdpApiService : CdpApiService {
    override suspend fun register(email: String): Result<Unit> = Result.success(Unit)
    override suspend fun verifyOtp(email: String, otp: String): Result<RegistrationSuccess> =
        Result.failure(Exception("Preview stub — OTP verification is not available."))
}

@Preview(showBackground = true)
@Composable
fun PreviewRegisterScreenEmailInput() {
    // Use a mock theme for preview purposes
    MaterialTheme {
        RegisterScreen(
            viewModel = RegisterViewModel(PreviewCdpApiService())
        )
    }
}

@Preview(showBackground = true)
@Composable
fun PreviewRegisterScreenOtpInput() {
    // Create a mock ViewModel state for OTP input
    val mockViewModel = RegisterViewModel(PreviewCdpApiService())
    mockViewModel.onEmailChange("test@example.com")
    // Manually set the step for preview purposes (in a real app, this is done by onRegisterClick)
    mockViewModel.viewModelScope.launch {
        mockViewModel.uiState.update { it.copy(currentStep = RegistrationStep.OtpInput) }
    }

    MaterialTheme {
        RegisterScreen(viewModel = mockViewModel)
    }
}
