package com.pos54link.screens

import android.content.Context
import android.util.Log
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import retrofit2.HttpException
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.util.concurrent.Executor

// --- 1. Data Layer: Entities, DAO, Database, Retrofit Service, Repository ---

// 1.1. Room Entities
@Entity(tableName = "exchange_rates")
data class ExchangeRateEntity(
    @PrimaryKey val fromCurrency: String,
    val toCurrency: String,
    val rate: Double,
    val timestamp: Long
)

// 1.2. Room DAO
@Dao
interface ExchangeRateDao {
    @Query("SELECT * FROM exchange_rates WHERE fromCurrency = :from AND toCurrency = :to")
    fun getRate(from: String, to: String): Flow<ExchangeRateEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRate(rate: ExchangeRateEntity)
}

// 1.3. Room Database (Minimal implementation for a single file)
@Database(entities = [ExchangeRateEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun exchangeRateDao(): ExchangeRateDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "remittance_db"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}

// 1.4. Retrofit Data Model
data class RateResponse(
    val success: Boolean,
    val base: String,
    val date: String,
    val rates: Map<String, Double>
)

// 1.5. Retrofit Service (Placeholder)
interface ExchangeRateService {
    @GET("latest")
    suspend fun getLatestRates(
        @Query("base") base: String,
        @Query("symbols") symbols: String
    ): Response<RateResponse>
}

// 1.6. Repository
class RateCalculatorRepository(
    private val apiService: ExchangeRateService,
    private val rateDao: ExchangeRateDao
) {
    private val BASE_CURRENCY = "NGN" // Nigerian Naira
    private val TARGET_CURRENCY = "USD" // US Dollar

    // Flow to fetch rate from API and cache it, or return cached rate
    fun getConversionRate(): Flow<Double?> = flow {
        // 1. Try to get rate from cache (offline mode)
        rateDao.getRate(BASE_CURRENCY, TARGET_CURRENCY).collect { cachedRate ->
            if (cachedRate != null) {
                emit(cachedRate.rate)
            }
        }

        // 2. Try to fetch from API
        try {
            val response = apiService.getLatestRates(BASE_CURRENCY, TARGET_CURRENCY)
            if (response.isSuccessful && response.body() != null) {
                val rateResponse = response.body()!!
                val rate = rateResponse.rates[TARGET_CURRENCY]
                if (rate != null) {
                    // Cache the new rate
                    val entity = ExchangeRateEntity(
                        fromCurrency = BASE_CURRENCY,
                        toCurrency = TARGET_CURRENCY,
                        rate = rate,
                        timestamp = System.currentTimeMillis()
                    )
                    rateDao.insertRate(entity)
                    emit(rate) // Emit the fresh rate
                } else {
                    throw IOException("Rate not found in API response.")
                }
            } else {
                throw HttpException(response)
            }
        } catch (e: Exception) {
            Log.e("RateRepo", "API call failed: ${e.message}")
            // If API fails, the flow will continue to emit the cached value if available.
            // No need to re-emit error here, as the UI should handle the absence of a fresh rate.
        }
    }.flowOn(Dispatchers.IO)
}

// --- 2. ViewModel Layer ---

// 2.1. UI State Data Class
data class RateCalculatorState(
    val amountToConvert: String = "1000",
    val conversionRate: Double? = null,
    val convertedAmount: Double? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val isBiometricAuthRequired: Boolean = true,
    val isPaymentProcessing: Boolean = false
)

// 2.2. ViewModel
class RateCalculatorViewModel(
    private val repository: RateCalculatorRepository
) : ViewModel() {

    private val _state = MutableStateFlow(RateCalculatorState())
    val state: StateFlow<RateCalculatorState> = _state.asStateFlow()

    private val _validationError = MutableStateFlow<String?>(null)
    val validationError: StateFlow<String?> = _validationError.asStateFlow()

    init {
        fetchConversionRate()
    }

    private fun fetchConversionRate() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            repository.getConversionRate()
                .collect { rate ->
                    _state.update { currentState ->
                        val newConvertedAmount = if (rate != null) {
                            currentState.amountToConvert.toDoubleOrNull()?.let { it * rate }
                        } else {
                            null
                        }
                        currentState.copy(
                            conversionRate = rate,
                            convertedAmount = newConvertedAmount,
                            isLoading = false,
                            error = if (rate == null) "Could not fetch fresh rate. Using offline data if available." else null
                        )
                    }
                }
        }
    }

    fun onAmountChange(newAmount: String) {
        if (newAmount.length > 10) return // Simple length validation

        _state.update { currentState ->
            val amountDouble = newAmount.toDoubleOrNull()
            val newConvertedAmount = if (amountDouble != null && currentState.conversionRate != null) {
                amountDouble * currentState.conversionRate
            } else {
                null
            }

            // Real-time validation
            _validationError.value = if (amountDouble == null && newAmount.isNotEmpty()) {
                "Invalid number format"
            } else if (amountDouble != null && amountDouble <= 0) {
                "Amount must be positive"
            } else {
                null
            }

            currentState.copy(
                amountToConvert = newAmount,
                convertedAmount = newConvertedAmount
            )
        }
    }

    fun initiatePayment(
        gateway: PaymentGateway,
        onAuthSuccess: () -> Unit,
        onAuthFailure: () -> Unit
    ) {
        if (_validationError.value != null || state.value.amountToConvert.toDoubleOrNull() == null) {
            _state.update { it.copy(error = "Please fix the input errors before proceeding.") }
            return
        }

        // The UI layer shows the real BiometricPrompt and invokes the callbacks.
        // Authentication must NEVER auto-succeed here — that would bypass the check.
        // onAuthSuccess is only called by the UI after BiometricPrompt confirms the user.
        _state.update { it.copy(isBiometricAuthRequired = true) }
    }

    /**
     * No real payment gateway is integrated yet. The simulation below only runs
     * when [allowSimulation] is true (debug builds); release builds get an
     * honest "not integrated" result and no fake success.
     *
     * TODO(payments): Integrate the real gateway SDKs (Paystack/Flutterwave/Interswitch).
     */
    fun processPayment(gateway: PaymentGateway, allowSimulation: Boolean = false) {
        viewModelScope.launch {
            _state.update { it.copy(isPaymentProcessing = true, error = null) }
            if (allowSimulation) {
                // DEBUG-ONLY simulation — never reported as a real payment.
                kotlinx.coroutines.delay(2000)
                _state.update {
                    it.copy(
                        isPaymentProcessing = false,
                        error = "Debug build: payment via ${gateway.name} simulated — no real transaction was made."
                    )
                }
            } else {
                _state.update {
                    it.copy(
                        isPaymentProcessing = false,
                        error = "Payments are not integrated yet — no transaction was made."
                    )
                }
            }
        }
    }
}

// --- 3. UI Layer: Composable Screen and Biometric Integration ---

// 3.1. Biometric Helper
fun showBiometricPrompt(
    context: Context,
    lifecycleOwner: LifecycleOwner,
    onSuccess: () -> Unit,
    onFailure: () -> Unit
) {
    val activity = context as? FragmentActivity ?: run {
        Log.e("Biometric", "Context is not a FragmentActivity")
        onFailure()
        return
    }

    val executor: Executor = ContextCompat.getMainExecutor(context)
    val biometricPrompt = BiometricPrompt(
        activity,
        executor,
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                super.onAuthenticationError(errorCode, errString)
                Log.e("Biometric", "Auth error: $errString")
                onFailure()
            }

            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                onSuccess()
            }

            override fun onAuthenticationFailed() {
                super.onAuthenticationFailed()
                Log.e("Biometric", "Auth failed")
                onFailure()
            }
        }
    )

    val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Biometric Authentication")
        .setSubtitle("Confirm your identity to proceed with payment")
        .setNegativeButtonText("Cancel")
        .setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG or androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        .build()

    biometricPrompt.authenticate(promptInfo)
}

// 3.2. Payment Gateway Enum
enum class PaymentGateway {
    PAYSTACK, FLUTTERWAVE, INTERSWITCH
}

// 3.3. Composable Screen
@Composable
fun RateCalculatorScreen(
    viewModel: RateCalculatorViewModel = createRateCalculatorViewModel(LocalContext.current)
) {
    val state by viewModel.state.collectAsState()
    val validationError by viewModel.validationError.collectAsState()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    // Payment simulation is only permitted in debuggable (debug) builds.
    val isDebugBuild = remember {
        (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Rate Calculator & Payment") })
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            item {
                Text(
                    text = "Real-time Currency Conversion",
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.padding(bottom = 16.dp)
                )
            }

            // Input Field (NGN)
            item {
                OutlinedTextField(
                    value = state.amountToConvert,
                    onValueChange = viewModel::onAmountChange,
                    label = { Text("Amount in NGN") },
                    leadingIcon = { Text("₦") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = validationError != null,
                    supportingText = {
                        if (validationError != null) {
                            Text(validationError!!)
                        } else {
                            Text("Enter the amount you wish to convert.")
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = "Amount to convert in Nigerian Naira" }
                )
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Conversion Rate Display
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Current Rate (NGN to USD):",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        if (state.isLoading) {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        } else {
                            val rateText = state.conversionRate?.let { "1 NGN = ${"%.4f".format(it)} USD" } ?: "Rate unavailable"
                            Text(
                                text = rateText,
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                                modifier = Modifier.semantics { contentDescription = "Current conversion rate is $rateText" }
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Converted Amount Display (USD)
            item {
                Text(
                    text = "Converted Amount (USD):",
                    style = MaterialTheme.typography.titleLarge
                )
                Spacer(modifier = Modifier.height(8.dp))
                val convertedText = state.convertedAmount?.let { "$${"%.2f".format(it)}" } ?: "---"
                Text(
                    text = convertedText,
                    style = MaterialTheme.typography.displaySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.semantics { contentDescription = "Converted amount is $convertedText US Dollars" }
                )
                Spacer(modifier = Modifier.height(24.dp))
            }

            // Payment Gateway Buttons
            item {
                Text(
                    text = "Select Payment Gateway",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.align(Alignment.Start)
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            PaymentGateway.entries.forEach { gateway ->
                item {
                    Button(
                        onClick = {
                            // 1. Show Biometric Prompt
                            showBiometricPrompt(
                                context = context,
                                lifecycleOwner = lifecycleOwner,
                                onSuccess = {
                                    // 2. On success, process payment (simulated only in debug builds)
                                    viewModel.processPayment(gateway, allowSimulation = isDebugBuild)
                                },
                                onFailure = {
                                    viewModel.onAmountChange(state.amountToConvert) // Trigger error state update
                                }
                            )
                        },
                        enabled = !state.isLoading && !state.isPaymentProcessing && validationError == null,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .semantics { contentDescription = "Pay with ${gateway.name}" }
                    ) {
                        Icon(Icons.Default.Lock, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Pay with ${gateway.name}")
                        if (state.isPaymentProcessing) {
                            Spacer(modifier = Modifier.width(8.dp))
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        }
                    }
                }
            }

            // Error/Status Message
            item {
                Spacer(modifier = Modifier.height(16.dp))
                state.error?.let {
                    Text(
                        text = it,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.semantics { contentDescription = "Status message: $it" }
                    )
                }
            }
        }
    }
}

// --- 4. Dependency Injection/Setup (Minimal for single file) ---

// Placeholder for Retrofit setup
private val retrofit = Retrofit.Builder()
    .baseUrl("https://api.54link.ng/exchange/v1/")
    .addConverterFactory(GsonConverterFactory.create())
    .build()

private val apiService = retrofit.create(ExchangeRateService::class.java)

// Factory function to create ViewModel
@Composable
fun createRateCalculatorViewModel(context: Context): RateCalculatorViewModel {
    val database = AppDatabase.getDatabase(context)
    val repository = remember { RateCalculatorRepository(apiService, database.exchangeRateDao()) }
    return remember { RateCalculatorViewModel(repository) }
}

// --- 5. Preview ---
@Preview(showBackground = true)
@Composable
fun PreviewRateCalculatorScreen() {
    // Note: The preview will not fully function due to the required Android context and dependencies (Room, Retrofit, BiometricPrompt)
    // but it provides a visual representation of the UI structure.
    MaterialTheme {
        RateCalculatorScreen(
            // Pass a mock ViewModel for better preview if needed, but using the factory for simplicity
            // in a real app, you'd use hiltViewModel() or a proper factory
            viewModel = RateCalculatorViewModel(
                RateCalculatorRepository(
                    apiService = object : ExchangeRateService {
                        override suspend fun getLatestRates(base: String, symbols: String): Response<RateResponse> {
                            return Response.success(RateResponse(true, "NGN", "2025-01-01", mapOf("USD" to 0.00065)))
                        }
                    },
                    rateDao = object : ExchangeRateDao {
                        override fun getRate(from: String, to: String): Flow<ExchangeRateEntity?> = flowOf(ExchangeRateEntity(from, to, 0.00065, System.currentTimeMillis()))
                        override suspend fun insertRate(rate: ExchangeRateEntity) {}
                    }
                )
            )
        )
    }
}

/*
* Documentation and Comments:
*
* This file contains the complete implementation for the RateCalculatorScreen following the MVVM pattern
* and using Jetpack Compose.
*
* Architecture:
* - Data Layer: ExchangeRateEntity (Room), ExchangeRateDao (Room), AppDatabase (Room), RateResponse (Retrofit),
*   ExchangeRateService (Retrofit), RateCalculatorRepository.
* - ViewModel Layer: RateCalculatorState, RateCalculatorViewModel (uses StateFlow for state management).
* - UI Layer: RateCalculatorScreen (Composable), showBiometricPrompt (Biometric integration helper).
*
* Key Features Implemented:
* - Jetpack Compose UI with Material Design 3 (Scaffold, TopAppBar, Card, OutlinedTextField, Button).
* - MVVM with ViewModel and Repository pattern.
* - State Management via Kotlin Flow/StateFlow.
* - Retrofit integration (Service and Data Model placeholders).
* - Offline Mode with Room (Repository first checks Room, then API, then caches).
* - Loading/Error States (isLoading, error in State).
* - Form Validation (real-time input validation in onAmountChange).
* - Biometric Authentication (showBiometricPrompt function, requires FragmentActivity context).
* - Payment Gateway Placeholders (PaymentGateway enum and buttons that trigger payment flow).
* - Accessibility (semantics modifiers for content descriptions).
*
* Dependencies required (to be added to build.gradle.kts):
* - androidx.compose.ui:ui
* - androidx.compose.material3:material3
* - androidx.lifecycle:lifecycle-viewmodel-ktx
* - androidx.lifecycle:lifecycle-runtime-compose
* - androidx.room:room-runtime
* - androidx.room:room-ktx
* - com.squareup.retrofit2:retrofit
* - com.squareup.retrofit2:converter-gson
* - androidx.biometric:biometric
* - androidx.activity:activity-compose
* - kotlinx.coroutines:kotlinx-coroutines-core
* - kotlinx.coroutines:kotlinx-coroutines-android
*/
